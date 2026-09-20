// Pure click-timing telemetry formulas — see the anti-cheat store
// (stores/antiCheatStore.ts) for the stateful ring buffer that calls these.
// No timestamps, coordinates, or device/browser identifiers ever leave this
// module in the digest it builds: only counts and a histogram shape.
import {
  HISTOGRAM_BUCKET_COUNT,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS
} from "@/utils/antiCheatConstants";

// Log-spaced inter-click-interval histogram, mirroring api/src/services/
// antiCheat.ts's bucketIndexForIntervalMs exactly — both sides must agree on
// which bucket a given interval falls into for the server's scoring to mean
// anything.
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

const BUCKET_EDGES = bucketEdgesMs();

export function bucketIndexForIntervalMs(ms: number): number {
  const overflowIndex = HISTOGRAM_BUCKET_COUNT - 1;
  if (!Number.isFinite(ms) || ms >= MAX_INTERVAL_MS) return overflowIndex;
  const clamped = Math.max(MIN_INTERVAL_MS, ms);
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    if (clamped < BUCKET_EDGES[i + 1]!) return i;
  }
  return overflowIndex - 1;
}

export function buildHistogram(intervalsMs: number[]): number[] {
  const buckets = new Array(HISTOGRAM_BUCKET_COUNT).fill(0) as number[];
  for (const ms of intervalsMs) {
    buckets[bucketIndexForIntervalMs(ms)]!++;
  }
  return buckets;
}

/**
 * Longest run of consecutive intervals within `tolerance` (relative) of the
 * window's own running median — the "metronome" signal. A human's hand
 * tremor breaks a run like this up long before an autoclicker's fixed (or
 * narrowly-jittered) timer does. Uses the median of the WHOLE window as a
 * single reference rather than a true rolling median — simpler, and the
 * difference only matters for a session whose pace changes dramatically
 * mid-window, which itself would break up the run anyway.
 */
export function computeMaxRunLength(intervalsMs: number[], tolerance = 0.05): number {
  if (intervalsMs.length === 0) return 0;
  const sorted = [...intervalsMs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  if (median <= 0) return 0;

  let longest = 0;
  let current = 0;
  for (const ms of intervalsMs) {
    if (Math.abs(ms - median) <= median * tolerance) {
      current++;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

// primary = left click, secondary = right click. Enter and Space are
// tracked SEPARATELY, not combined into one "keyboard" bucket — a human
// alternating both keys (one finger each) can legitimately sustain nearly
// double the rate either key alone could, the same way alternating
// left/right mouse buttons can; lumping them together would make that
// entirely normal two-key alternation look like 100% concentration in a
// single method to the server's singleMethodExceedsHumanLimit signal. See
// ClickerCircle.vue's own button/detail/keydown split, which already
// computes this distinction and previously discarded it before it ever
// reached telemetry.
export type ClickMethod = "primary" | "secondary" | "enter" | "space";

export interface MethodCounts {
  primary: number;
  secondary: number;
  enter: number;
  space: number;
}

export interface AntiCheatDigest {
  windowMs: number;
  clicks: number;
  purchases: number;
  buckets: number[];
  maxRunLength: number;
  untrustedClicks: number;
  hiddenClicks: number;
  droppedClicks: number;
  // Zero-false-positive (script-integrity/honeypot) — see
  // api/src/services/antiCheat.ts, decisive server-side on its own.
  integrityFlags: string[];
  // Pointer-physics consistency flags — corroborating only, never decisive
  // alone. Keep this split in sync with the api's own digest schema.
  weakSignals: string[];
  // Optional — an older cached client omitting this must never be rejected
  // for it (see the windowMs incident this project already had once): the
  // server just skips the single-input-method signal when absent, rather
  // than 400ing the whole digest over a missing-but-non-essential field.
  methodCounts?: MethodCounts;
}

export interface DigestInputs {
  windowMs: number;
  clickTimestamps: number[]; // performance.now() values, ascending
  purchases: number;
  untrustedClicks: number;
  hiddenClicks: number;
  droppedClicks: number;
  integrityFlags: string[];
  weakSignals: string[];
  methodCounts: MethodCounts;
}

/**
 * The client-side burst cap: how many of `timestamps` (ascending,
 * performance.now() values) fall within `windowMs` of `now`. A click beyond
 * BURST_CPS_CAP in the same rolling window is dropped silently — no token,
 * no flag, no telemetry entry — a legitimate player who grazes it just
 * loses a click and never notices. Kept as a pure counting function so
 * antiCheatStore.ts's ring buffer stays the only piece of mutable state.
 */
export function countWithinWindow(timestamps: number[], now: number, windowMs: number): number {
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (now - timestamps[i]! > windowMs) break;
    count++;
  }
  return count;
}

/** Builds the exact payload POST /anticheat/report expects, from a window's
 * raw (trusted, counted) click timestamps plus the counters gathered
 * alongside them. */
export function buildDigest(input: DigestInputs): AntiCheatDigest {
  const intervals: number[] = [];
  for (let i = 1; i < input.clickTimestamps.length; i++) {
    intervals.push(input.clickTimestamps[i]! - input.clickTimestamps[i - 1]!);
  }
  return {
    windowMs: input.windowMs,
    clicks: input.clickTimestamps.length,
    purchases: input.purchases,
    buckets: buildHistogram(intervals),
    maxRunLength: computeMaxRunLength(intervals),
    untrustedClicks: input.untrustedClicks,
    hiddenClicks: input.hiddenClicks,
    droppedClicks: input.droppedClicks,
    integrityFlags: input.integrityFlags,
    weakSignals: input.weakSignals,
    methodCounts: input.methodCounts
  };
}
