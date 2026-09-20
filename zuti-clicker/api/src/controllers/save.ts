import express from "express";
import { getSave, upsertSave, deleteSave, type UnitInput } from "../database/models/saveData";
import { Responses } from "../constants/responses";
import { isKnownUpgradeId } from "../constants/upgrades";

interface SaveBody {
  tokens?: unknown;
  totalTokensEarned?: unknown;
  totalClicks?: unknown;
  elapsedSeconds?: unknown;
  phdCount?: unknown;
  prestigeCount?: unknown;
  runTokensEarned?: unknown;
  runClicks?: unknown;
  runSeconds?: unknown;
  units?: unknown;
  upgrades?: unknown;
}

function isValidUnits(units: unknown): units is UnitInput[] {
  if (!Array.isArray(units)) return false;
  const shapeValid = units.every((u) => {
    if (u === null || typeof u !== "object") return false;
    const entry = u as Record<string, unknown>;
    return (
      typeof entry["unitId"] === "string" &&
      typeof entry["owned"] === "number" &&
      (entry["owned"] as number) >= 0
    );
  });
  if (!shapeValid) return false;
  // A duplicate unitId would otherwise reach upsertSave's createMany and
  // throw on UnitSave's (gameSaveId, unitId) unique constraint — a 500 (and,
  // with database/retry.ts's write-conflict retry, three wasted attempts at
  // it) instead of the 400 a present-but-invalid value must get. Same check
  // isValidUpgrades already does for upgrade ids below.
  const unitIds = (units as UnitInput[]).map((u) => u.unitId);
  return new Set(unitIds).size === unitIds.length;
}

// Optional (older clients predate the upgrades system entirely), but a
// *present* value must be an array of known upgrade ids — unlike unitId
// (any string is accepted, since units are purely client-defined and never
// validated server-side), upgrades ARE allowlisted here because the booster
// system reads specific ids (conferenceBadge, departmentNewsletter) back off
// this same data server-side (see database/models/boosters.ts).
function isValidUpgrades(upgrades: unknown): upgrades is string[] | undefined {
  if (upgrades === undefined) return true;
  if (!Array.isArray(upgrades)) return false;
  if (!upgrades.every((id) => isKnownUpgradeId(id))) return false;
  // A duplicate id would otherwise reach upsertSave's createMany and throw
  // on UpgradeSave's (gameSaveId, upgradeId) unique constraint — a 500, not
  // the 400 a present-but-invalid value must get.
  return new Set(upgrades).size === upgrades.length;
}

// MySQL/MariaDB signed INT range — phdCount, prestigeCount, and runClicks are
// all Int columns, and a value outside this range makes Prisma throw, which
// the catch block below would turn into a misleading 500 instead of a 400.
const MAX_INT32 = 2147483647;

// Prestige fields are optional (older clients omit them entirely), but a
// *present* value must be a sane non-negative number. Number.isInteger matters
// for the Int columns: a fractional value would make Prisma throw, which the
// catch block below would turn into a misleading 500 instead of a 400.
function isOptionalCount(value: unknown): value is number | undefined {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_INT32;
}

function isOptionalAmount(value: unknown): value is number | undefined {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * @openapi
 * /save:
 *   get:
 *     tags:
 *       - Save
 *     summary: Load the current user's game save
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: Save data (or null if no save exists yet)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoadSaveResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const loadSave = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    const save = await getSave(userId);

    if (!save) {
      res.status(200).json({ save: null });
      return;
    }

    const now = Date.now();
    res.status(200).json({
      save: {
        tokens: save.tokens,
        totalTokensEarned: save.totalTokensEarned,
        totalClicks: save.totalClicks,
        elapsedSeconds: save.elapsedSeconds,
        phdCount: save.phdCount,
        prestigeCount: save.prestigeCount,
        runTokensEarned: save.runTokensEarned,
        runClicks: save.runClicks,
        runSeconds: save.runSeconds,
        savedAt: save.savedAt,
        units: save.units.map((u) => ({ unitId: u.unitId, owned: u.owned })),
        upgrades: save.upgrades.map((u) => u.upgradeId),
        // Read-only — see SaveInput's comment on why PUT /save can't touch
        // this. remainingMs, never the row's absolute expiresAt: the client
        // anchors it to its own clock the instant it's loaded (gameStore's
        // loadFromSave), so server/client clock skew can't extend a buff.
        activeBoosters: save.activeBoosters.map((b) => ({
          boosterId: b.boosterId,
          remainingMs: Math.max(0, b.expiresAt.getTime() - now)
        }))
      }
    });
  } catch (error) {
    console.error("Load save error:", error);
    const r = Responses.SAVE.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};

/**
 * @openapi
 * /save:
 *   put:
 *     tags:
 *       - Save
 *     summary: Create or overwrite the current user's game save
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/StoreSaveRequest'
 *     responses:
 *       '200':
 *         description: Save persisted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StoreSaveResponse'
 *       '400':
 *         description: Missing required fields, or invalid (present but malformed) units, prestige fields, or upgrades
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const storeSave = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    const {
      tokens,
      totalTokensEarned,
      totalClicks,
      elapsedSeconds,
      phdCount,
      prestigeCount,
      runTokensEarned,
      runClicks,
      runSeconds,
      units,
      upgrades
    } = req.body as SaveBody;

    if (
      typeof tokens !== "number" ||
      typeof totalTokensEarned !== "number" ||
      typeof totalClicks !== "number" ||
      typeof elapsedSeconds !== "number" ||
      !isValidUnits(units)
    ) {
      const r =
        typeof tokens !== "number" ||
        typeof totalTokensEarned !== "number" ||
        typeof totalClicks !== "number" ||
        typeof elapsedSeconds !== "number"
          ? Responses.SAVE.MISSING_FIELDS
          : Responses.SAVE.INVALID_UNITS;
      res.status(r.status).json(r.body);
      return;
    }

    if (
      !isOptionalCount(phdCount) ||
      !isOptionalCount(prestigeCount) ||
      !isOptionalCount(runClicks) ||
      !isOptionalAmount(runTokensEarned) ||
      !isOptionalAmount(runSeconds)
    ) {
      const r = Responses.SAVE.INVALID_PRESTIGE;
      res.status(r.status).json(r.body);
      return;
    }

    if (!isValidUpgrades(upgrades)) {
      const r = Responses.SAVE.INVALID_UPGRADES;
      res.status(r.status).json(r.body);
      return;
    }

    const save = await upsertSave(userId, {
      tokens,
      totalTokensEarned,
      totalClicks,
      elapsedSeconds,
      phdCount,
      prestigeCount,
      runTokensEarned,
      runClicks,
      runSeconds,
      units,
      upgrades
    });

    const r = Responses.SAVE.SAVE_SUCCESS;
    res.status(r.status).json({ ...r.body, savedAt: save.savedAt });
  } catch (error) {
    console.error("Store save error:", error);
    const r = Responses.SAVE.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};

/**
 * @openapi
 * /save:
 *   delete:
 *     tags:
 *       - Save
 *     summary: Reset (delete) the current user's game save
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: Save reset (idempotent — succeeds even if no save existed)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MessageResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const resetSave = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    await deleteSave(userId);

    const r = Responses.SAVE.RESET_SUCCESS;
    res.status(r.status).json(r.body);
  } catch (error) {
    console.error("Reset save error:", error);
    const r = Responses.SAVE.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};
