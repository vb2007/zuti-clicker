// The statistical click-timing verdict — Layer 3 of the anti-cheat system.
// Pure, stateless scoring of a single reported digest; the stateful part
// (tracking consecutive suspicious windows, issuing strikes) lives in
// database/models/antiCheat.ts, which calls into this file.
//
// No single signal here is ever decisive alone — see MIN_SCORE_TO_FLAG /
// MIN_DISTINCT_SIGNALS_TO_FLAG. Raw click rate (sustainedRate) is
// deliberately weighted low: two people mashing input together on the same
// account can plausibly graze a high CPS average without ever tripping the
// variance/support/run-length signals a real autoclicker does.
import {
  HISTOGRAM_BUCKET_COUNT,
  HISTOGRAM_SUM_TOLERANCE,
  MAX_DIGEST_WINDOW_MS,
  ENVELOPE_MAX_CPS,
  CV_THRESHOLD,
  MIN_CLICKS_FOR_VARIANCE_SIGNAL,
  MIN_CPS_FOR_VARIANCE_SIGNAL,
  RUN_LENGTH_THRESHOLD,
  NARROW_SUPPORT_MAX_SPAN,
  UNIMODAL_SPIKE_FRACTION,
  UNIFORM_SKEW_THRESHOLD,
  UNIFORM_SPAN_MAX,
  SUSTAINED_RATE_CPS,
  SINGLE_METHOD_MAX_CPS,
  SINGLE_METHOD_CONCENTRATION,
  MIN_SCORE_TO_FLAG,
  MIN_DISTINCT_SIGNALS_TO_FLAG
} from "../constants/antiCheat";

// Log-spaced inter-click-interval histogram: MIN_INTERVAL_MS..MAX_INTERVAL_MS
// across HISTOGRAM_BUCKET_COUNT-1 buckets, with one final overflow bucket for
// anything at or beyond MAX_INTERVAL_MS (a pause between clicking sessions,
// not a "fast" interval). Keep these two constants in sync with
// frontend/src/utils/clickTelemetry.ts's own copy — both sides must agree on
// what bucket index a given interval falls into.
export const MIN_INTERVAL_MS = 15;
export const MAX_INTERVAL_MS = 3000;

function bucketEdgesMs(): number[] {
  const finiteBuckets = HISTOGRAM_BUCKET_COUNT - 1;
  const logMin = Math.log(MIN_INTERVAL_MS);
  const logMax = Math.log(MAX_INTERVAL_MS);
  const edges: number[] = [];
  for (let i = 0; i <= finiteBuckets; i++) {
    edges.push(Math.exp(logMin + ((logMax - logMin) * i) / finiteBuckets));
  }
  return edges;
}

/** Which bucket index a single interval (ms) falls into. Exported so a
 * client-side implementation can be tested against the same function via
 * the api's own test suite; the frontend keeps its own copy in sync. */
export function bucketIndexForIntervalMs(ms: number): number {
  const overflowIndex = HISTOGRAM_BUCKET_COUNT - 1;
  if (!Number.isFinite(ms) || ms >= MAX_INTERVAL_MS) return overflowIndex;
  const edges = bucketEdgesMs();
  const clamped = Math.max(MIN_INTERVAL_MS, ms);
  for (let i = 0; i < edges.length - 1; i++) {
    if (clamped < edges[i + 1]!) return i;
  }
  return overflowIndex - 1;
}

// Geometric-mean midpoint of each finite bucket — the natural "representative
// value" for a log-spaced bin, used to approximate mean/variance/skew from
// counts alone (the server never receives raw timestamps).
function bucketMidpointsMs(): number[] {
  const edges = bucketEdgesMs();
  const midpoints: number[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    midpoints.push(Math.sqrt(edges[i]! * edges[i + 1]!));
  }
  midpoints.push(MAX_INTERVAL_MS * 1.5); // overflow bucket's representative value
  return midpoints;
}

export interface AntiCheatDigest {
  windowMs: number;
  clicks: number;
  purchases: number;
  buckets: number[];
  // Longest run of consecutive intervals within ~5% of the window's own
  // running median — computed client-side, where raw timestamps exist.
  maxRunLength: number;
  untrustedClicks: number;
  hiddenClicks: number;
  droppedClicks: number;
  // Zero-false-positive: a script dispatching synthetic events, or failing a
  // native-function-integrity/honeypot check (Layer 2) has no legitimate
  // explanation at all — decisive on the very first report.
  integrityFlags: string[];
  // NOT zero-false-positive (pointer-physics consistency checks — unusual
  // but real hardware/drivers can occasionally look odd) — scored at weight
  // 1 each alongside the statistical signals below, never decisive alone.
  weakSignals: string[];
  // Optional — an older cached client omitting this must never be rejected
  // for it (see the windowMs incident this project already had once): the
  // digest is simply evaluated without the singleMethodExceedsHumanLimit
  // signal, exactly as if it always reported a perfectly even split.
  //
  // enter/space are tracked SEPARATELY, not combined into one "keyboard"
  // count — a human alternating both keys (one finger each) can
  // legitimately sustain nearly double the rate either key alone could,
  // the same way alternating left/right mouse buttons can. Combining them
  // would make that entirely normal two-key alternation look like 100%
  // concentration in a single method below.
  methodCounts?: { primary: number; secondary: number; enter: number; space: number };
}

export interface DigestVerdict {
  // A digest that contradicts its OWN numbers (bucket sum vs click count, or
  // a rate beyond the envelope's own ceiling) is EVIDENCE — a well-formed
  // body that lies about itself has no innocent explanation. Still never
  // decisive on the very first report though (see
  // database/models/antiCheat.ts's processDigest): it goes through the
  // normal "2 consecutive flagged windows" rule, same as every statistical
  // signal, giving a false-triggering client every chance to recover
  // before it costs the player anything.
  consistent: boolean;
  inconsistencyReason?: string;
  // Whether this digest carried enough well-formed information to score at
  // all. false means NO INFORMATION — never evidence of anything, in
  // either direction (see scoreable's own comment on isValidShape and the
  // MAX_DIGEST_WINDOW_MS check below for what lands here and why).
  scoreable: boolean;
  unscoreableReason?: string;
  score: number;
  signals: string[];
  flagged: boolean; // score/signal thresholds met, independent of consistency
}

export type MethodCounts = { primary: number; secondary: number; enter: number; space: number };

// Absent, OR present but not matching the expected shape, are both treated
// as "no method data" for the singleMethodExceedsHumanLimit signal ONLY —
// NEVER a reason to reject the whole digest. Regression: this used to be
// part of isValidShape, so a malformed-but-present methodCounts (e.g. a
// stale cached client still shipping the old {primary, secondary, keyboard}
// shape from before enter/space were split out) 400'd the ENTIRE report —
// not just skipping this one signal, skipping every signal — reproducing
// the exact class of bug the windowMs incident already taught this project
// to avoid for an optional field.
//
// `value` is typed `unknown`, not AntiCheatDigest["methodCounts"], and
// exported: this is the ONE shared implementation for both the controller
// (the untrusted request boundary, where the value really is arbitrary
// JSON) and this file's own evaluateDigest (defense-in-depth, exercised
// directly by unit tests). Two independently hand-maintained copies is
// exactly the duplication shape that let the original bug exist in the
// first place — a future change (e.g. a 5th input method) updating one
// copy and not the other would silently reintroduce it in whichever layer
// got missed.
export function sanitizeMethodCounts(value: unknown): MethodCounts | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const { primary, secondary, enter, space } = v;
  if (
    Number.isInteger(primary) &&
    (primary as number) >= 0 &&
    Number.isInteger(secondary) &&
    (secondary as number) >= 0 &&
    Number.isInteger(enter) &&
    (enter as number) >= 0 &&
    Number.isInteger(space) &&
    (space as number) >= 0
  ) {
    return {
      primary: primary as number,
      secondary: secondary as number,
      enter: enter as number,
      space: space as number
    };
  }
  return undefined;
}

// Genuinely structural problems only — a non-integer count, a missing/
// wrong-length bucket array, and so on. windowMs's UPPER bound is
// deliberately NOT checked here (see evaluateDigest's own oversized-window
// branch below): a client bug producing a structurally wrong body and a
// browser suspending a timer through a whole backgrounded window are both
// "no information", but the latter is expected to happen constantly on
// real devices (locking a phone, switching apps) and must be visibly
// distinguished (unscoreableReason) even though both are treated the same
// way — neutral, never a strike.
function isValidShape(digest: AntiCheatDigest): boolean {
  return (
    Number.isFinite(digest.windowMs) &&
    digest.windowMs > 0 &&
    Number.isInteger(digest.clicks) &&
    digest.clicks >= 0 &&
    Array.isArray(digest.buckets) &&
    digest.buckets.length === HISTOGRAM_BUCKET_COUNT &&
    digest.buckets.every((n) => Number.isInteger(n) && n >= 0) &&
    Number.isInteger(digest.maxRunLength) &&
    digest.maxRunLength >= 0 &&
    Array.isArray(digest.integrityFlags) &&
    digest.integrityFlags.every((f) => typeof f === "string") &&
    Array.isArray(digest.weakSignals) &&
    digest.weakSignals.every((f) => typeof f === "string")
  );
}

export function evaluateDigest(digest: AntiCheatDigest): DigestVerdict {
  if (!isValidShape(digest)) {
    // Structurally malformed — a client bug or a stale/differently-shaped
    // build, not evidence of anything. This project has hit exactly this
    // class of bug FOUR times in production (windowMs precision,
    // methodCounts shape, ...); a real forger sends a well-formed body, so
    // treating "can't be parsed" as "certainly cheating" only ever
    // punishes legitimate quirks.
    return {
      consistent: true,
      scoreable: false,
      unscoreableReason: "malformed_digest",
      score: 0,
      signals: [],
      flagged: false
    };
  }

  // A window the browser's own timer was suspended through — a backgrounded
  // tab, a locked screen, a laptop lid close — carries no meaningful timing
  // data at all: `clicks` is typically 0 and `windowMs` is however long the
  // suspension lasted, not a real measurement of anything. This is the
  // exact root cause of a real production incident ("banned for opening
  // the prestige modal for a few seconds" on iOS/WebKit, which suspends
  // setInterval while backgrounded). The client should skip sending these
  // (see frontend antiCheatConstants.ts's own MAX_DIGEST_WINDOW_MS), but a
  // client that ships one anyway — stale cache, a platform quirk this
  // project hasn't seen yet — must never be punished for the browser's own
  // scheduler; treated as unscoreable, exactly like an absent digest.
  if (digest.windowMs > MAX_DIGEST_WINDOW_MS) {
    return {
      consistent: true,
      scoreable: false,
      unscoreableReason: "window_out_of_range",
      score: 0,
      signals: [],
      flagged: false
    };
  }

  const bucketSum = digest.buckets.reduce((a, b) => a + b, 0);
  // clicks-1 intervals per click run, but a report can span a restart (no
  // "previous click" for the first one) — a small fixed tolerance absorbs
  // that without weakening the check against real tampering.
  if (Math.abs(bucketSum - Math.max(0, digest.clicks - 1)) > HISTOGRAM_SUM_TOLERANCE) {
    return {
      consistent: false,
      inconsistencyReason: "bucket_sum_mismatch",
      scoreable: true,
      score: 0,
      signals: [],
      flagged: false
    };
  }

  const cps = digest.clicks / (digest.windowMs / 1000);
  if (cps > ENVELOPE_MAX_CPS) {
    return {
      consistent: false,
      inconsistencyReason: "rate_exceeds_envelope",
      scoreable: true,
      score: 0,
      signals: [],
      flagged: false
    };
  }

  // Zero-false-positive signals — a script dispatching synthetic events
  // through the click handler (untrustedClicks) or touching a honeypot/
  // failing a script-integrity check (integrityFlags) has no legitimate
  // explanation at all (see Layer 2's design), so either is immediately
  // decisive on its own — no need to wait for a second corroborating signal
  // or a second consecutive window the way the statistical signals below do.
  if (digest.untrustedClicks > 0 || digest.integrityFlags.length > 0) {
    const signals = digest.untrustedClicks > 0 ? ["untrustedInput"] : [];
    for (const flag of digest.integrityFlags) signals.push(`integrity:${flag}`);
    return { consistent: true, scoreable: true, score: 99, signals, flagged: true };
  }

  const signals: string[] = [];
  let score = 0;

  // Distributional stats from bucket midpoints — biased toward slightly
  // OVERSTATING variance (using each bucket's single representative value
  // rather than the true spread within it), which is the safe direction: it
  // makes lowVariance/uniformShape harder, not easier, to trigger.
  if (bucketSum > 0) {
    const midpoints = bucketMidpointsMs();
    const n = bucketSum;
    const mean = digest.buckets.reduce((sum, count, i) => sum + count * midpoints[i]!, 0) / n;
    const variance =
      digest.buckets.reduce((sum, count, i) => sum + count * (midpoints[i]! - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(variance);
    const cv = mean > 0 ? stddev / mean : 0;
    const skew =
      stddev > 0
        ? digest.buckets.reduce((sum, count, i) => sum + count * ((midpoints[i]! - mean) / stddev) ** 3, 0) / n
        : 0;
    const nonEmptyIndices = digest.buckets
      .map((count, i) => (count > 0 ? i : -1))
      .filter((i) => i >= 0);
    const span = nonEmptyIndices.length > 0 ? nonEmptyIndices[nonEmptyIndices.length - 1]! - nonEmptyIndices[0]! : 0;
    const topFraction = Math.max(...digest.buckets) / n;

    if (cv < CV_THRESHOLD && digest.clicks >= MIN_CLICKS_FOR_VARIANCE_SIGNAL && cps >= MIN_CPS_FOR_VARIANCE_SIGNAL) {
      signals.push("lowVariance");
      score += 2;
    }
    if (nonEmptyIndices.length > 0 && span <= NARROW_SUPPORT_MAX_SPAN && digest.clicks >= MIN_CLICKS_FOR_VARIANCE_SIGNAL) {
      signals.push("narrowSupport");
      score += 2;
    }
    if (topFraction > UNIMODAL_SPIKE_FRACTION && digest.clicks >= MIN_CLICKS_FOR_VARIANCE_SIGNAL) {
      signals.push("unimodalSpike");
      score += 1;
    }
    if (Math.abs(skew) < UNIFORM_SKEW_THRESHOLD && span <= UNIFORM_SPAN_MAX && span > 0 && digest.clicks >= MIN_CLICKS_FOR_VARIANCE_SIGNAL) {
      signals.push("uniformShape");
      score += 1;
    }
  }

  if (digest.maxRunLength >= RUN_LENGTH_THRESHOLD) {
    signals.push("metronome");
    score += 2;
  }

  if (cps > SUSTAINED_RATE_CPS) {
    signals.push("sustainedRate");
    score += 1;
  }

  // singleMethodExceedsHumanLimit — see the constant's own comment for the
  // research this threshold is based on. Absent, or present but malformed
  // (e.g. a stale client's old shape), for an older client — never a
  // rejection, see sanitizeMethodCounts's own comment.
  const sanitizedMethodCounts = sanitizeMethodCounts(digest.methodCounts);
  if (sanitizedMethodCounts) {
    const { primary, secondary, enter, space } = sanitizedMethodCounts;
    const methodTotal = primary + secondary + enter + space;
    if (methodTotal >= MIN_CLICKS_FOR_VARIANCE_SIGNAL) {
      const dominant = Math.max(primary, secondary, enter, space);
      if (dominant / methodTotal >= SINGLE_METHOD_CONCENTRATION) {
        const methodCps = methodTotal / (digest.windowMs / 1000);
        if (methodCps > SINGLE_METHOD_MAX_CPS) {
          signals.push("singleMethodExceedsHumanLimit");
          score += 2;
        }
      }
    }
  }

  for (const flag of digest.weakSignals) {
    signals.push(`weak:${flag}`);
    score += 1;
  }

  const distinctSignals = new Set(signals).size;
  const flagged = score >= MIN_SCORE_TO_FLAG && distinctSignals >= MIN_DISTINCT_SIGNALS_TO_FLAG;

  return { consistent: true, scoreable: true, score, signals, flagged };
}
