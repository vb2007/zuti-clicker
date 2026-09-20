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
  methodCounts?: { primary: number; secondary: number; keyboard: number };
}

export interface DigestVerdict {
  // A digest that contradicts its own numbers (bucket sum vs click count, or
  // an impossible rate) is certain, not merely suspicious — see
  // database/models/antiCheat.ts for how this short-circuits the
  // "2 consecutive windows" requirement below.
  consistent: boolean;
  inconsistencyReason?: string;
  score: number;
  signals: string[];
  flagged: boolean; // score/signal thresholds met, independent of consistency
}

function isValidMethodCounts(value: AntiCheatDigest["methodCounts"]): boolean {
  if (value === undefined) return true; // omitted entirely — see the field's own comment
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isInteger(value.primary) &&
    value.primary >= 0 &&
    Number.isInteger(value.secondary) &&
    value.secondary >= 0 &&
    Number.isInteger(value.keyboard) &&
    value.keyboard >= 0
  );
}

function isValidShape(digest: AntiCheatDigest): boolean {
  return (
    Number.isFinite(digest.windowMs) &&
    digest.windowMs > 0 &&
    digest.windowMs <= MAX_DIGEST_WINDOW_MS &&
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
    digest.weakSignals.every((f) => typeof f === "string") &&
    isValidMethodCounts(digest.methodCounts)
  );
}

export function evaluateDigest(digest: AntiCheatDigest): DigestVerdict {
  if (!isValidShape(digest)) {
    return { consistent: false, inconsistencyReason: "malformed_digest", score: 0, signals: [], flagged: false };
  }

  const bucketSum = digest.buckets.reduce((a, b) => a + b, 0);
  // clicks-1 intervals per click run, but a report can span a restart (no
  // "previous click" for the first one) — a small fixed tolerance absorbs
  // that without weakening the check against real tampering.
  if (Math.abs(bucketSum - Math.max(0, digest.clicks - 1)) > HISTOGRAM_SUM_TOLERANCE) {
    return { consistent: false, inconsistencyReason: "bucket_sum_mismatch", score: 0, signals: [], flagged: false };
  }

  const cps = digest.clicks / (digest.windowMs / 1000);
  if (cps > ENVELOPE_MAX_CPS) {
    return { consistent: false, inconsistencyReason: "rate_exceeds_envelope", score: 0, signals: [], flagged: false };
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
    return { consistent: true, score: 99, signals, flagged: true };
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
  // research this threshold is based on. Absent for an older client that
  // doesn't report it yet (never a rejection — see the field's own comment).
  if (digest.methodCounts) {
    const { primary, secondary, keyboard } = digest.methodCounts;
    const methodTotal = primary + secondary + keyboard;
    if (methodTotal >= MIN_CLICKS_FOR_VARIANCE_SIGNAL) {
      const dominant = Math.max(primary, secondary, keyboard);
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

  return { consistent: true, score, signals, flagged };
}
