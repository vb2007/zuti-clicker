import express from "express";
import { getSave, upsertSave, deleteSave, type UnitInput } from "../database/models/saveData";
import { Responses } from "../constants/responses";
import { isKnownUpgradeId } from "../constants/upgrades";
import { isKnownUnitId, MAX_UNIT_OWNED } from "../constants/gameBalance";
import { ANTICHEAT_MODE } from "../constants/antiCheat";
import {
  evaluateSaveEnvelope,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator";
import { logAntiCheatEvent } from "../database/models/antiCheat";

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

// Hardened as part of the anti-cheat save envelope (see
// services/saveValidator.ts): unitId is now allowlisted against the known
// unit ids (previously any string was accepted — see the comment this
// replaced, which explicitly documented that as intentional), and `owned`
// must be a genuine non-negative integer no greater than MAX_UNIT_OWNED, not
// merely `>= 0`. This check runs unconditionally (not gated by
// ANTICHEAT_MODE) — it is basic input validation, not a heuristic.
function isValidUnits(units: unknown): units is UnitInput[] {
  if (!Array.isArray(units)) return false;
  const shapeValid = units.every((u) => {
    if (u === null || typeof u !== "object") return false;
    const entry = u as Record<string, unknown>;
    return (
      isKnownUnitId(entry["unitId"]) &&
      typeof entry["owned"] === "number" &&
      Number.isInteger(entry["owned"]) &&
      (entry["owned"] as number) >= 0 &&
      (entry["owned"] as number) <= MAX_UNIT_OWNED
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

// A genuine non-negative integer within the Int column's range. Number.isInteger
// matters for the Int columns: a fractional value would make Prisma throw,
// which the catch block below would turn into a misleading 500 instead of a 400.
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_INT32;
}

// Prestige fields are optional (older clients omit them entirely), but a
// *present* value must be a sane non-negative number.
function isOptionalCount(value: unknown): value is number | undefined {
  return value === undefined || isCount(value);
}

function isOptionalAmount(value: unknown): value is number | undefined {
  if (value === undefined) return true;
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// tokens and totalTokensEarned can legitimately differ by a sliver at the
// last representable float bit — this is slack for that, not an invitation
// to overshoot: a real forged excess is caught by the plausibility envelope
// (services/saveValidator.ts), which compares against the previous save
// rather than trusting a single request in isolation.
const CORE_FIELD_EPSILON = 1e-6;

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
 *         description: >
 *           Missing required fields; a present-but-invalid core field
 *           (negative/non-finite, or a fractional totalClicks); tokens
 *           exceeding totalTokensEarned; or invalid units, prestige fields,
 *           or upgrades.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '409':
 *         description: >
 *           Rejected by the save plausibility envelope: a monotonicity
 *           break, or a value more than twice what's achievable since the
 *           last save (see docs/developer/final.md's "Anti-cheat modell"
 *           section). Nothing is written — GET /save still returns the last
 *           verified state. Never returned when ANTICHEAT_MODE is "off" or
 *           "monitor".
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const storeSave = async (req: express.Request, res: express.Response) => {
  try {
    const identity = req.identity;
    if (identity === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }
    const userId = identity.id;

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
      typeof elapsedSeconds !== "number"
    ) {
      const r = Responses.SAVE.MISSING_FIELDS;
      res.status(r.status).json(r.body);
      return;
    }

    // From here tokens/totalTokensEarned/totalClicks/elapsedSeconds are all
    // genuinely typeof "number" — but that alone still lets through NaN,
    // Infinity, negative values, and a fractional totalClicks (an Int
    // column). This runs unconditionally, independent of ANTICHEAT_MODE: it
    // is basic input validation, not a heuristic — see services/
    // saveValidator.ts for the plausibility envelope that IS mode-gated.
    if (
      !Number.isFinite(tokens) ||
      tokens < 0 ||
      !Number.isFinite(totalTokensEarned) ||
      totalTokensEarned < 0 ||
      !Number.isFinite(elapsedSeconds) ||
      elapsedSeconds < 0 ||
      !isCount(totalClicks)
    ) {
      const r = Responses.SAVE.INVALID_CORE_FIELDS;
      res.status(r.status).json(r.body);
      return;
    }

    // The current balance can never exceed everything ever earned — spending
    // only ever decreases `tokens`, never `totalTokensEarned`. A small
    // epsilon absorbs float round-tripping; a real forged excess is still
    // caught here as anyone actually inflating tokens without inflating
    // totalTokensEarned to match is exactly the "granted free tokens" attack.
    if (tokens > totalTokensEarned + CORE_FIELD_EPSILON) {
      const r = Responses.SAVE.TOKENS_EXCEED_EARNED;
      res.status(r.status).json(r.body);
      return;
    }

    if (!isValidUnits(units)) {
      const r = Responses.SAVE.INVALID_UNITS;
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

    // Everything below is the save plausibility envelope (see
    // services/saveValidator.ts) — the request body has passed every
    // stateless shape/bounds check above, but hasn't yet been checked
    // against what this account could actually have achieved since its last
    // save. `effective*` starts as the validated request value and is only
    // ever adjusted DOWN by a clamp-tier verdict; ANTICHEAT_MODE=off skips
    // this block entirely (a raw local API client), "monitor" evaluates and
    // logs but never adjusts or rejects, and "enforce" (the only mode
    // production can run in) does both.
    let effectiveTokens = tokens;
    let effectiveTotalTokensEarned = totalTokensEarned;
    let effectiveTotalClicks = totalClicks;
    let effectiveElapsedSeconds = elapsedSeconds;

    if (ANTICHEAT_MODE !== "off") {
      const previous = await getSave(userId);
      // The same "omitted means preserve the stored value" resolution
      // upsertSave itself applies below — the envelope needs the REAL
      // after-state a write would produce, not the raw (possibly absent)
      // request fields.
      const resolvedPhdCount = phdCount ?? previous?.phdCount ?? 0;
      const resolvedPrestigeCount = prestigeCount ?? previous?.prestigeCount ?? 0;
      const resolvedUpgrades = upgrades ?? previous?.upgrades.map((u) => u.upgradeId) ?? [];

      const prevSnapshot: PrevSaveSnapshot | null = previous
        ? {
            tokens: previous.tokens,
            totalTokensEarned: previous.totalTokensEarned,
            totalClicks: previous.totalClicks,
            elapsedSeconds: previous.elapsedSeconds,
            phdCount: previous.phdCount,
            prestigeCount: previous.prestigeCount,
            savedAt: previous.savedAt,
            units: previous.units.map((u) => ({ unitId: u.unitId, owned: u.owned })),
            upgrades: previous.upgrades.map((u) => u.upgradeId)
          }
        : null;

      const incomingSnapshot: IncomingSave = {
        tokens,
        totalTokensEarned,
        totalClicks,
        elapsedSeconds,
        phdCount: resolvedPhdCount,
        prestigeCount: resolvedPrestigeCount,
        units,
        upgrades: resolvedUpgrades
      };

      // identity.createdAt anchors a first-ever save's dt, closing "register
      // then immediately PUT a maxed save".
      const verdict = evaluateSaveEnvelope(
        prevSnapshot,
        identity.createdAt,
        new Date(),
        incomingSnapshot
      );

      if (verdict.outcome !== "accept") {
        await logAntiCheatEvent({
          userId,
          kind: verdict.outcome === "reject" ? "envelope_reject" : "envelope_clamp",
          severity: "info",
          mode: ANTICHEAT_MODE,
          detail:
            verdict.outcome === "reject"
              ? { reason: verdict.reason, ...verdict.detail }
              : { reasons: verdict.reasons, ...verdict.detail },
          enforced: ANTICHEAT_MODE === "enforce"
        }).catch((e: unknown) => console.error("Failed to log anti-cheat event:", e));
      }

      if (ANTICHEAT_MODE === "enforce") {
        if (verdict.outcome === "reject") {
          const r = Responses.SAVE.IMPLAUSIBLE;
          res.status(r.status).json(r.body);
          return;
        }
        if (verdict.outcome === "clamp") {
          if (verdict.clamped.tokens !== undefined) effectiveTokens = verdict.clamped.tokens;
          if (verdict.clamped.totalTokensEarned !== undefined) {
            effectiveTotalTokensEarned = verdict.clamped.totalTokensEarned;
          }
          if (verdict.clamped.totalClicks !== undefined) {
            effectiveTotalClicks = verdict.clamped.totalClicks;
          }
          if (verdict.clamped.elapsedSeconds !== undefined) {
            effectiveElapsedSeconds = verdict.clamped.elapsedSeconds;
          }
        }
      }
    }

    const save = await upsertSave(userId, {
      tokens: effectiveTokens,
      totalTokensEarned: effectiveTotalTokensEarned,
      totalClicks: effectiveTotalClicks,
      elapsedSeconds: effectiveElapsedSeconds,
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
