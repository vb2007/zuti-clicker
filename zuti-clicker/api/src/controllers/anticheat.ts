import express from "express";
import { Responses } from "../constants/responses";
import { ANTICHEAT_MODE } from "../constants/antiCheat";
import { HISTOGRAM_BUCKET_COUNT } from "../constants/antiCheat";
import { processDigest, getAntiCheatStatus } from "../database/models/antiCheat";
import type { AntiCheatDigest } from "../services/antiCheat";

interface ReportBody {
  windowMs?: unknown;
  clicks?: unknown;
  purchases?: unknown;
  buckets?: unknown;
  maxRunLength?: unknown;
  untrustedClicks?: unknown;
  hiddenClicks?: unknown;
  droppedClicks?: unknown;
  integrityFlags?: unknown;
  weakSignals?: unknown;
  methodCounts?: unknown;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

type MethodCounts = { primary: number; secondary: number; enter: number; space: number };

// Absent, OR present but not matching the expected shape, are both treated
// as "no method data" — NEVER a reason to reject the whole digest. This is
// deliberately more lenient than a plain type guard: a stale cached client
// (still shipping the old {primary, secondary, keyboard} shape from before
// enter/space were split out, e.g. mid-rollout or a browser serving a
// cached bundle) sends a well-formed but differently-shaped methodCounts
// object, which must not poison an otherwise-valid report the same way the
// windowMs incident did. Confirmed empirically: before this fix, the old
// shape's mismatch made isValidMethodCounts return false, which fed
// straight into parseDigest's overall condition and 400'd the ENTIRE
// digest — not just skipping the new signal, skipping every signal.
function sanitizeMethodCounts(value: unknown): MethodCounts | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (
    isNonNegativeInt(v["primary"]) &&
    isNonNegativeInt(v["secondary"]) &&
    isNonNegativeInt(v["enter"]) &&
    isNonNegativeInt(v["space"])
  ) {
    return { primary: v["primary"], secondary: v["secondary"], enter: v["enter"], space: v["space"] };
  }
  return undefined;
}

// windowMs is a genuine millisecond DURATION (performance.now() delta), not
// a count — it is legitimately fractional (e.g. 60001.2), unlike every
// other field here. Regression: this used to be checked with
// isNonNegativeInt, which rejected every real-world report with a 400
// before it ever reached evaluateDigest — every hand-written test fixture
// on both sides happened to use an integer literal (windowMs: 60_000),
// masking it until a real browser's performance.now() value hit production.
function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Shape-only validation — the substantive checks (bucket sum vs click count,
// rate vs the envelope's own ceiling) live in services/antiCheat.ts's
// evaluateDigest, which is what actually decides whether a well-shaped
// digest is internally consistent.
function parseDigest(body: ReportBody): AntiCheatDigest | null {
  if (
    !isNonNegativeFiniteNumber(body.windowMs) ||
    body.windowMs === 0 ||
    !isNonNegativeInt(body.clicks) ||
    !isNonNegativeInt(body.purchases) ||
    !Array.isArray(body.buckets) ||
    body.buckets.length !== HISTOGRAM_BUCKET_COUNT ||
    !body.buckets.every((n) => isNonNegativeInt(n)) ||
    !isNonNegativeInt(body.maxRunLength) ||
    !isNonNegativeInt(body.untrustedClicks) ||
    !isNonNegativeInt(body.hiddenClicks) ||
    !isNonNegativeInt(body.droppedClicks) ||
    !Array.isArray(body.integrityFlags) ||
    !body.integrityFlags.every((f) => typeof f === "string") ||
    !Array.isArray(body.weakSignals) ||
    !body.weakSignals.every((f) => typeof f === "string")
  ) {
    return null;
  }
  return {
    windowMs: body.windowMs,
    clicks: body.clicks,
    purchases: body.purchases,
    buckets: body.buckets as number[],
    maxRunLength: body.maxRunLength,
    untrustedClicks: body.untrustedClicks,
    hiddenClicks: body.hiddenClicks,
    droppedClicks: body.droppedClicks,
    integrityFlags: body.integrityFlags as string[],
    weakSignals: body.weakSignals as string[],
    methodCounts: sanitizeMethodCounts(body.methodCounts)
  };
}

/**
 * @openapi
 * /anticheat/report:
 *   post:
 *     tags:
 *       - AntiCheat
 *     summary: Submit a click-timing telemetry digest for server-side evaluation
 *     description: >
 *       Sent on a fixed heartbeat (independent of the autosave setting) and
 *       immediately on a local hard detection. Carries no game state and
 *       never writes the save — see docs/developer/final.md's "Anti-cheat
 *       modell" section. A no-op (still 200) when ANTICHEAT_MODE is "off".
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AntiCheatReportRequest'
 *     responses:
 *       '200':
 *         description: Report evaluated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AntiCheatReportResponse'
 *       '400':
 *         description: Malformed digest
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const submitReport = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    if (ANTICHEAT_MODE === "off") {
      const r = Responses.ANTICHEAT.REPORT_SUCCESS;
      res.status(r.status).json({ ...r.body, status: "clean", restrictedUntil: null, strikeCount: 0 });
      return;
    }

    const digest = parseDigest(req.body as ReportBody);
    if (!digest) {
      const r = Responses.ANTICHEAT.INVALID_DIGEST;
      res.status(r.status).json(r.body);
      return;
    }

    const result = await processDigest(userId, digest, ANTICHEAT_MODE, ANTICHEAT_MODE === "enforce");

    const r = Responses.ANTICHEAT.REPORT_SUCCESS;
    res.status(r.status).json({
      ...r.body,
      status: result.status.isRestricted ? "restricted" : "clean",
      restrictedUntil: result.status.restrictedUntil,
      strikeCount: result.status.strikeCount
    });
  } catch (error) {
    console.error("Submit anti-cheat report error:", error);
    const r = Responses.ANTICHEAT.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};

/**
 * @openapi
 * /anticheat/status:
 *   get:
 *     tags:
 *       - AntiCheat
 *     summary: Get the current user's anti-cheat restriction status
 *     description: >
 *       Lets the client show an accurate countdown (or recover after a page
 *       reload mid-restriction) without waiting for a write endpoint to 403.
 *       Never gated by requireNotRestricted itself.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: Current status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AntiCheatStatusResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const getStatus = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    if (ANTICHEAT_MODE === "off") {
      res.status(200).json({ isRestricted: false, restrictedUntil: null, strikeCount: 0 });
      return;
    }

    const status = await getAntiCheatStatus(userId, ANTICHEAT_MODE === "enforce");
    res.status(200).json({
      isRestricted: status.isRestricted,
      restrictedUntil: status.restrictedUntil,
      strikeCount: status.strikeCount
    });
  } catch (error) {
    console.error("Get anti-cheat status error:", error);
    const r = Responses.ANTICHEAT.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};
