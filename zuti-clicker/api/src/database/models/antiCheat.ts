import { prisma } from "../prisma";
import { deleteSave } from "./saveData";
import type { AntiCheatMode } from "../../constants/antiCheat";
import {
  RESTRICTION_MINUTES_BY_STRIKE,
  SAVE_RESET_STRIKE,
  STRIKE_DECAY_DAYS,
  SOFT_CLAMP_STRIKE_THRESHOLD,
  NO_FATIGUE_STREAK,
  SUSPICIOUS_WINDOWS_TO_STRIKE,
  MIN_SCORE_TO_FLAG,
  MIN_DISTINCT_SIGNALS_TO_FLAG
} from "../../constants/antiCheat";
import { evaluateDigest, type AntiCheatDigest } from "../../services/antiCheat";

// Append-only — see the AntiCheatEvent model's own comment in schema.prisma
// for why this exists (tuning the detection thresholds against real
// traffic) and why it is never treated as a source of game-state truth.
// `severity` is "info" until services/antiCheat.ts's strike ladder (a later
// commit) actually applies a penalty for an event, at which point that
// service re-logs it as "strike" — logEvent itself never escalates.
export interface LogEventInput {
  userId: number;
  kind: string;
  severity: "info" | "strike";
  mode: AntiCheatMode;
  detail: unknown;
  enforced: boolean;
}

export async function logAntiCheatEvent(input: LogEventInput): Promise<void> {
  await prisma.antiCheatEvent.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      severity: input.severity,
      mode: input.mode,
      // Prisma's Json input type wants JsonValue, not `unknown` — a plain
      // JSON.parse(JSON.stringify(...)) round-trip is the simplest way to
      // satisfy that without hand-writing a recursive type guard, and it's
      // cheap: these payloads are small diagnostic objects, not save data.
      detail: JSON.parse(JSON.stringify(input.detail)),
      enforced: input.enforced
    }
  });
}

// ---- Strike ladder / restriction state (Layer 4) --------------------------

export interface AntiCheatStatus {
  strikeCount: number;
  restrictedUntil: Date | null;
  isRestricted: boolean;
}

function restrictionMinutesForStrike(strike: number): number {
  if (strike <= 0) return 0;
  const idx = Math.min(strike, RESTRICTION_MINUTES_BY_STRIKE.length) - 1;
  return RESTRICTION_MINUTES_BY_STRIKE[idx]!;
}

// Decays the strike count by one level per STRIKE_DECAY_DAYS of consecutive
// clean time (see lastCleanAt's own comment in schema.prisma), and clears
// the softClampCount/suspicionScore/highRateWindows accumulators along with
// it — a long enough clean stretch should wipe minor accumulated suspicion,
// not just formal strikes. `lastCleanAt` only ever moves forward by whole
// STRIKE_DECAY_DAYS increments, so a partial clean stretch isn't lost.
async function decayIfDue<
  T extends {
    id: number;
    strikeCount: number;
    lastCleanAt: Date;
    softClampCount: number;
    suspicionScore: number;
    highRateWindows: number;
  }
>(state: T, now: Date): Promise<T> {
  if (state.strikeCount <= 0 && state.softClampCount <= 0 && state.suspicionScore <= 0) return state;
  const daysClean = (now.getTime() - state.lastCleanAt.getTime()) / (1000 * 60 * 60 * 24);
  const levels = Math.floor(daysClean / STRIKE_DECAY_DAYS);
  if (levels <= 0) return state;

  const newStrikeCount = Math.max(0, state.strikeCount - levels);
  const newLastCleanAt = new Date(state.lastCleanAt.getTime() + levels * STRIKE_DECAY_DAYS * 24 * 60 * 60 * 1000);
  const updated = await prisma.antiCheatState.update({
    where: { id: state.id },
    data: {
      strikeCount: newStrikeCount,
      lastCleanAt: newLastCleanAt,
      softClampCount: 0,
      suspicionScore: 0,
      highRateWindows: 0
    }
  });
  return updated as unknown as T;
}

async function getOrCreateState(userId: number) {
  return prisma.antiCheatState.upsert({
    where: { userId },
    update: {},
    create: { userId }
  });
}

export async function getAntiCheatStatus(userId: number): Promise<AntiCheatStatus> {
  const now = new Date();
  const state = await decayIfDue(await getOrCreateState(userId), now);
  const isRestricted = state.restrictedUntil !== null && state.restrictedUntil.getTime() > now.getTime();
  return { strikeCount: state.strikeCount, restrictedUntil: state.restrictedUntil, isRestricted };
}

export interface StrikeOutcome {
  strikeCount: number;
  restrictedUntil: Date;
  saveWasReset: boolean;
}

/**
 * Issues a strike. When `enforced` is false (ANTICHEAT_MODE=monitor), every
 * number here is still computed and logged (severity: "strike", enforced:
 * false) but nothing is actually written to AntiCheatState or GameSave —
 * "monitor" must never block or penalise, only observe what would happen.
 */
export async function applyStrike(
  userId: number,
  kind: string,
  mode: AntiCheatMode,
  enforced: boolean,
  detail: unknown
): Promise<StrikeOutcome> {
  const now = new Date();
  const current = await decayIfDue(await getOrCreateState(userId), now);
  const strikeCount = current.strikeCount + 1;
  const minutes = restrictionMinutesForStrike(strikeCount);
  const restrictedUntil = new Date(now.getTime() + minutes * 60 * 1000);
  const saveWasReset = strikeCount === SAVE_RESET_STRIKE;

  await logAntiCheatEvent({
    userId,
    kind,
    severity: "strike",
    mode,
    detail: { ...((detail as object) ?? {}), strikeCount, restrictedUntil, saveWasReset },
    enforced
  });

  if (enforced) {
    await prisma.antiCheatState.update({
      where: { id: current.id },
      data: {
        strikeCount,
        restrictedUntil,
        lastStrikeAt: now,
        lastCleanAt: now,
        softClampCount: 0,
        suspicionScore: 0,
        highRateWindows: 0,
        lastStrikeReason: kind.slice(0, 64)
      }
    });
    if (saveWasReset) {
      await deleteSave(userId);
    }
  }

  return { strikeCount, restrictedUntil, saveWasReset };
}

/**
 * A soft clamp (the save envelope silently adjusting a value down, rather
 * than rejecting outright) is invisible noise on its own — a PATTERN of them
 * is not. Escalates to a real strike once SOFT_CLAMP_STRIKE_THRESHOLD have
 * accumulated since the account was last clean.
 */
export async function recordSoftClamp(
  userId: number,
  mode: AntiCheatMode,
  enforced: boolean,
  detail: unknown
): Promise<StrikeOutcome | null> {
  const now = new Date();
  const current = await decayIfDue(await getOrCreateState(userId), now);
  const softClampCount = current.softClampCount + 1;

  await logAntiCheatEvent({ userId, kind: "envelope_clamp", severity: "info", mode, detail, enforced });

  if (softClampCount >= SOFT_CLAMP_STRIKE_THRESHOLD) {
    return applyStrike(userId, "envelope_clamp_pattern", mode, enforced, {
      ...((detail as object) ?? {}),
      softClampCount
    });
  }

  if (enforced) {
    await prisma.antiCheatState.update({
      where: { id: current.id },
      data: { softClampCount, lastCleanAt: now }
    });
  }
  return null;
}

export interface DigestResult {
  status: AntiCheatStatus;
  flagged: boolean;
  struck: boolean;
}

/**
 * Scores a reported click-timing digest (services/antiCheat.ts) and applies
 * the "2 consecutive flagged windows" escalation — except for the
 * zero-false-positive signals (untrusted input, integrity flags) and outright
 * digest inconsistency, which are decisive on the very first report (see
 * evaluateDigest's own comments).
 */
export async function processDigest(
  userId: number,
  digest: AntiCheatDigest,
  mode: AntiCheatMode,
  enforced: boolean
): Promise<DigestResult> {
  const now = new Date();
  const current = await decayIfDue(await getOrCreateState(userId), now);
  const verdict = evaluateDigest(digest);

  const sawSustainedRate = verdict.signals.includes("sustainedRate");
  const highRateWindows = sawSustainedRate ? current.highRateWindows + 1 : 0;
  let score = verdict.score;
  const signals = [...verdict.signals];
  if (verdict.consistent && highRateWindows >= NO_FATIGUE_STREAK) {
    signals.push("noFatigue");
    score += 1;
  }
  const distinctSignals = new Set(signals).size;
  const flagged =
    verdict.consistent && (verdict.flagged || (score >= MIN_SCORE_TO_FLAG && distinctSignals >= MIN_DISTINCT_SIGNALS_TO_FLAG));

  // A digest that contradicts its own numbers, or trips a zero-false-positive
  // signal, is decisive immediately — everything else needs a second
  // consecutive flagged window (tracked via suspicionScore) before striking.
  const decisiveNow = !verdict.consistent || digest.untrustedClicks > 0 || digest.integrityFlags.length > 0;

  await logAntiCheatEvent({
    userId,
    kind: verdict.consistent ? "statistical_digest" : `digest_inconsistent:${verdict.inconsistencyReason}`,
    severity: flagged ? "strike" : "info",
    mode,
    detail: { score, signals, distinctSignals, flagged, decisiveNow },
    enforced: enforced && flagged
  });

  if (!flagged) {
    if (enforced) {
      await prisma.antiCheatState.update({
        where: { id: current.id },
        data: { suspicionScore: 0, highRateWindows }
      });
    }
    const status = await getAntiCheatStatus(userId);
    return { status, flagged: false, struck: false };
  }

  const suspicionScore = current.suspicionScore + 1;
  if (decisiveNow || suspicionScore >= SUSPICIOUS_WINDOWS_TO_STRIKE) {
    await applyStrike(userId, verdict.consistent ? "statistical_verdict" : "digest_inconsistent", mode, enforced, {
      score,
      signals,
      inconsistencyReason: verdict.inconsistencyReason
    });
    const status = await getAntiCheatStatus(userId);
    return { status, flagged: true, struck: enforced };
  }

  if (enforced) {
    await prisma.antiCheatState.update({
      where: { id: current.id },
      data: { suspicionScore, highRateWindows, lastCleanAt: now }
    });
  }
  const status = await getAntiCheatStatus(userId);
  return { status, flagged: true, struck: false };
}
