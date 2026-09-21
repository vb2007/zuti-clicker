import { prisma } from "../prisma";
import { deleteSave } from "./saveData";
import type { AntiCheatMode } from "../../constants/antiCheat";
import {
  RESTRICTION_MINUTES_BY_STRIKE,
  SAVE_RESET_STRIKE,
  STRIKE_DECAY_DAYS,
  SOFT_CLAMP_STRIKE_THRESHOLD,
  ANTICHEAT_STATE_WINDOW_HOURS,
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
//
// `enforced` gates the actual DB write, not the decay computation itself —
// "monitor" mode must observe what WOULD happen (including how a strike
// ladder decision would read a decayed state) without ever mutating
// AntiCheatState, so the decayed values are always computed and returned,
// only persisted when enforced.
async function decayIfDue<
  T extends {
    id: number;
    strikeCount: number;
    lastCleanAt: Date;
    softClampCount: number;
    softClampWindowStartedAt: Date | null;
    suspicionScore: number;
    highRateWindows: number;
  }
>(state: T, now: Date, enforced: boolean): Promise<T> {
  if (state.strikeCount <= 0 && state.softClampCount <= 0 && state.suspicionScore <= 0) return state;
  const daysClean = (now.getTime() - state.lastCleanAt.getTime()) / (1000 * 60 * 60 * 24);
  const levels = Math.floor(daysClean / STRIKE_DECAY_DAYS);
  if (levels <= 0) return state;

  const newStrikeCount = Math.max(0, state.strikeCount - levels);
  const newLastCleanAt = new Date(state.lastCleanAt.getTime() + levels * STRIKE_DECAY_DAYS * 24 * 60 * 60 * 1000);
  if (!enforced) {
    return {
      ...state,
      strikeCount: newStrikeCount,
      lastCleanAt: newLastCleanAt,
      softClampCount: 0,
      // Paired with softClampCount everywhere else it's written
      // (recordSoftClamp, applyStrike) — a decay that wipes the counter
      // but leaves this stale would let a future recordSoftClamp call
      // wrongly treat a long-dead window as still current.
      softClampWindowStartedAt: null,
      suspicionScore: 0,
      highRateWindows: 0
    };
  }
  const updated = await prisma.antiCheatState.update({
    where: { id: state.id },
    data: {
      strikeCount: newStrikeCount,
      lastCleanAt: newLastCleanAt,
      softClampCount: 0,
      softClampWindowStartedAt: null,
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

// `enforced` defaults to true so a bare status read (e.g. a "must be
// restricted to reach here" check) keeps its previous behavior; the few
// callers evaluating a request under a known, possibly non-enforced mode
// (recordSoftClamp/applyStrike/processDigest, and the status endpoint) pass
// their own `enforced` through explicitly instead.
export async function getAntiCheatStatus(userId: number, enforced = true): Promise<AntiCheatStatus> {
  const now = new Date();
  const state = await decayIfDue(await getOrCreateState(userId), now, enforced);
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
  const current = await decayIfDue(await getOrCreateState(userId), now, enforced);
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
        softClampWindowStartedAt: null,
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
  material: boolean,
  detail: unknown
): Promise<StrikeOutcome | null> {
  const now = new Date();
  const current = await decayIfDue(await getOrCreateState(userId), now, enforced);

  // Always logged — the audit trail is unchanged regardless of materiality
  // or enforcement; only the STRIKE-worthiness of the pattern below changes.
  await logAntiCheatEvent({
    userId,
    kind: "envelope_clamp",
    severity: "info",
    mode,
    detail: { ...((detail as object) ?? {}), material },
    enforced
  });

  // An immaterial clamp (pure float64 residue — see
  // SOFT_CLAMP_MATERIAL_RATIO's own comment) never counts toward the
  // pattern, however many times it repeats. A clamp already neutralizes
  // the gain (the server writes the bounded value; nothing survives to
  // the attacker either way), so noise here isn't even weak evidence —
  // this is what a real production incident hit: 5 consecutive clamps
  // (the OLD threshold), all pure rounding residue, escalated to an actual
  // strike against a completely legitimate account.
  if (!material) return null;

  // Roll the window: a material clamp from more than
  // ANTICHEAT_STATE_WINDOW_HOURS ago no longer contributes to the pattern.
  // This counter previously had NO time window at all — any
  // SOFT_CLAMP_STRIKE_THRESHOLD material clamps ever, however far apart,
  // would have escalated.
  const windowStart = current.softClampWindowStartedAt;
  const windowExpired =
    windowStart === null ||
    now.getTime() - windowStart.getTime() > ANTICHEAT_STATE_WINDOW_HOURS * 60 * 60 * 1000;
  const softClampCount = windowExpired ? 1 : current.softClampCount + 1;
  const softClampWindowStartedAt = windowExpired ? now : windowStart;

  if (softClampCount >= SOFT_CLAMP_STRIKE_THRESHOLD) {
    return applyStrike(userId, "envelope_clamp_pattern", mode, enforced, {
      ...((detail as object) ?? {}),
      softClampCount
    });
  }

  if (enforced) {
    await prisma.antiCheatState.update({
      where: { id: current.id },
      data: { softClampCount, softClampWindowStartedAt }
      // lastCleanAt is deliberately NOT touched here (unlike the previous
      // version of this function) — a clamp already neutralizes the gain
      // and must not also block the 30-day strike-decay clock the way it
      // used to for any account that clamps at all.
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
  const current = await decayIfDue(await getOrCreateState(userId), now, enforced);
  const verdict = evaluateDigest(digest);

  // A digest with no valid information at all — a structurally malformed
  // body, or a window the browser's own timer was suspended through (see
  // evaluateDigest's own comments; this is the direct fix for a real
  // production incident where a backgrounded/locked phone's next heartbeat
  // struck a completely idle player) — is NEUTRAL, not evidence of
  // anything in EITHER direction. It must never move suspicionScore toward
  // a strike, but it also must never reset a genuinely flagged streak the
  // way a real clean window does (that would let a cheater launder a
  // flagged streak by injecting a bogus digest between real ones).
  // Logged separately (kind: "digest_unscoreable") so this is visible in
  // the audit trail without being confused with either a clean window or
  // an inconsistent one.
  if (!verdict.scoreable) {
    await logAntiCheatEvent({
      userId,
      kind: "digest_unscoreable",
      severity: "info",
      mode,
      detail: { unscoreableReason: verdict.unscoreableReason },
      enforced: false
    });
    // Built directly from `current` (already the decayed state from
    // above) instead of calling getAntiCheatStatus, which would redo the
    // exact same getOrCreateState+decayIfDue sequence with no write in
    // between — worth avoiding specifically here, since an unscoreable
    // window (a backgrounded/suspended browser tab) is expected to be a
    // FREQUENT path on real devices, not a rare one.
    const isRestricted = current.restrictedUntil !== null && current.restrictedUntil.getTime() > now.getTime();
    const status: AntiCheatStatus = {
      strikeCount: current.strikeCount,
      restrictedUntil: current.restrictedUntil,
      isRestricted
    };
    return { status, flagged: false, struck: false };
  }

  // A zero-false-positive signal (untrusted input, an integrity flag) is
  // decisive immediately. A digest that contradicts its OWN numbers
  // (`!verdict.consistent` — bucket_sum_mismatch, rate_exceeds_envelope) is
  // ALSO decisive immediately, same as it always was: unlike the unscoreable
  // case above (a structurally malformed body, or a window the browser
  // suspended through — genuinely no information), a well-shaped digest
  // whose own numbers contradict each other has no innocent production
  // incident behind it and no legitimate client bug is known to produce it
  // — there is nothing to give a "second window to recover" grace period
  // for. (An earlier version of this fix folded !verdict.consistent into
  // the ordinary 2-consecutive-window `flagged` path instead, on the theory
  // that it deserved the same leniency as a statistical signal — but that
  // opens a real evasion: alternating one inconsistent digest with one
  // clean digest resets suspicionScore on every clean window, so the
  // pattern never reaches 2 consecutive and never strikes at all.)
  const decisiveNow =
    !verdict.consistent || digest.untrustedClicks > 0 || digest.integrityFlags.length > 0;

  const sawSustainedRate = verdict.consistent && verdict.signals.includes("sustainedRate");
  const highRateWindows = sawSustainedRate ? current.highRateWindows + 1 : 0;
  let score = verdict.consistent ? verdict.score : 0;
  const signals = verdict.consistent ? [...verdict.signals] : [];
  if (verdict.consistent && highRateWindows >= NO_FATIGUE_STREAK) {
    signals.push("noFatigue");
    score += 1;
  }
  const distinctSignals = new Set(signals).size;
  const flagged =
    decisiveNow ||
    (verdict.consistent &&
      (verdict.flagged || (score >= MIN_SCORE_TO_FLAG && distinctSignals >= MIN_DISTINCT_SIGNALS_TO_FLAG)));

  await logAntiCheatEvent({
    userId,
    // kind is VARCHAR(32) — the reason goes in `detail`, never appended here
    // (e.g. "digest_inconsistent:rate_exceeds_envelope" alone is 42 chars).
    kind: verdict.consistent ? "statistical_digest" : "digest_inconsistent",
    severity: flagged ? "strike" : "info",
    mode,
    detail: { score, signals, distinctSignals, flagged, decisiveNow, inconsistencyReason: verdict.inconsistencyReason },
    enforced: enforced && flagged
  });

  if (!flagged) {
    if (enforced) {
      await prisma.antiCheatState.update({
        where: { id: current.id },
        data: { suspicionScore: 0, highRateWindows }
      });
    }
    const status = await getAntiCheatStatus(userId, enforced);
    return { status, flagged: false, struck: false };
  }

  const suspicionScore = current.suspicionScore + 1;
  if (decisiveNow || suspicionScore >= SUSPICIOUS_WINDOWS_TO_STRIKE) {
    await applyStrike(userId, verdict.consistent ? "statistical_verdict" : "digest_inconsistent", mode, enforced, {
      score,
      signals,
      inconsistencyReason: verdict.inconsistencyReason
    });
    const status = await getAntiCheatStatus(userId, enforced);
    return { status, flagged: true, struck: enforced };
  }

  if (enforced) {
    await prisma.antiCheatState.update({
      where: { id: current.id },
      data: { suspicionScore, highRateWindows, lastCleanAt: now }
    });
  }
  const status = await getAntiCheatStatus(userId, enforced);
  return { status, flagged: true, struck: false };
}
