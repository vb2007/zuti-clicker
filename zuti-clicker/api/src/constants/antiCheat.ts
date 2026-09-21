// Anti-cheat thresholds and mode resolution. Every threshold here is
// deliberately loose — see the plan this implements: "never penalise a
// legitimate player" outranks catching a cheater. Nothing in this file is
// ever shipped to the client; that is the whole point of running the
// statistical/plausibility verdict server-side instead of in the bundle.

export type AntiCheatMode = "enforce" | "monitor" | "off";

const VALID_MODES: readonly AntiCheatMode[] = ["enforce", "monitor", "off"];

function isValidMode(value: string): value is AntiCheatMode {
  return (VALID_MODES as readonly string[]).includes(value);
}

// Pure — takes its inputs explicitly rather than reading process.env
// directly, so the decision logic (including the production-lockout branch)
// is unit-testable without the module-reload gymnastics a real env var
// would otherwise require. See src/tests/antiCheatMode.test.ts.
export function resolveAntiCheatMode(env: {
  ANTICHEAT_MODE?: string;
  NODE_ENV?: string;
}): AntiCheatMode {
  const raw = env.ANTICHEAT_MODE;
  let requested: AntiCheatMode = "enforce";
  if (raw !== undefined && raw !== "") {
    if (isValidMode(raw)) {
      requested = raw;
    } else {
      console.warn(
        `ANTICHEAT_MODE="${raw}" is not one of enforce|monitor|off — defaulting to "enforce".`
      );
    }
  }

  // Production can never run as anything but "enforce" — a misconfigured
  // deploy silently shipping with anti-cheat off is a far worse failure than
  // a loud warning and a forced override.
  if (env.NODE_ENV === "production" && requested !== "enforce") {
    console.warn(
      `ANTICHEAT_MODE="${requested}" was requested but NODE_ENV=production — forcing "enforce". ` +
        `"off"/"monitor" are for local development only.`
    );
    return "enforce";
  }
  return requested;
}

// Resolved once at module load (mirroring how the rest of the API reads env
// vars — see src/index.ts). "off" skips validation entirely (for a raw local
// API client); "monitor" runs every check and logs the verdict but never
// blocks or clamps (for tuning thresholds against real traffic).
export const ANTICHEAT_MODE: AntiCheatMode = resolveAntiCheatMode({
  ANTICHEAT_MODE: process.env.ANTICHEAT_MODE,
  NODE_ENV: process.env.NODE_ENV
});

// ---- Save plausibility envelope (services/saveValidator.ts) --------------

// Clock-skew grace added to the wall-clock interval between two saves —
// generous enough to absorb client/server clock drift and request latency
// without ever tightening the window a legitimate player gets.
export const CLOCK_GRACE_SECS = 5;

// Hard ceiling on clicks/sec used to bound how many clicks could have been
// registered in an interval. This is a generous envelope backstop, not the
// statistical detector's flag threshold (see SUSTAINED_RATE_CPS below) — a
// human mashing with both hands can plausibly graze this; it exists to catch
// values that are simply impossible, not merely suspicious.
export const ENVELOPE_MAX_CPS = 45;

// A value between the honest bound and REJECT_MULTIPLIER times over it is
// silently clamped down to the bound rather than rejected outright — this is
// what keeps a mistuned/borderline threshold from ever costing a legitimate
// player their save; only something at least twice what's achievable is
// treated as certainly forged.
export const REJECT_MULTIPLIER = 2;

// Multiplicative slack on top of the theoretical max earn rate — covers crit
// variance, imprecise interval timing, and multiplier-stacking edge cases the
// formula doesn't model exactly, always erring toward accepting more.
export const EARNED_ACCEPT_MARGIN = 1.5;

// Slack term on the prestige/PhD plausibility bounds below — absorbs the
// edge case of a run's not-yet-flushed final tokens and boundary rounding.
export const PHD_BOUND_SLACK = 1;
export const PRESTIGE_COUNT_SLACK = 2;

// How many soft clamps within ANTICHEAT_STATE_WINDOW_HOURS escalate to a real
// strike — a single clamp is invisible noise; a pattern of them is not.
export const SOFT_CLAMP_STRIKE_THRESHOLD = 5;
export const ANTICHEAT_STATE_WINDOW_HOURS = 24;

// ---- Penalty ladder (services/antiCheat.ts) -------------------------------

// Index 0 = strike 1. Strike 5+ is a save reset, not a duration — see
// applyStrike in services/antiCheat.ts. No permanent ban exists in this
// system by design.
export const RESTRICTION_MINUTES_BY_STRIKE = [1, 15, 120, 1440] as const;
export const SAVE_RESET_STRIKE = 5;

// Consecutive clean days that decay the strike count by one level.
export const STRIKE_DECAY_DAYS = 30;

// ---- Statistical click-timing verdict (services/antiCheat.ts, Layer 3) ---
//
// The client ships a compact digest of its own click-interval histogram on a
// fixed heartbeat, independent of the autosave setting (see
// POST /anticheat/report) — thresholds here never ship to the client, so
// tuning them is a server redeploy, not something a cheat script can read.
// No single signal is ever decisive on its own; see evaluateDigest.

// The heartbeat's own cadence — also the ceiling on how old/large a reported
// window may be before it's treated as internally inconsistent.
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const MAX_DIGEST_WINDOW_MS = HEARTBEAT_INTERVAL_MS * 2; // grace for a delayed report

// Fixed-length inter-click-interval histogram the client reports — log-spaced
// buckets from 0 to 3000ms plus one overflow bucket. Kept here (not just in
// the frontend) so the server can validate the shape of what it's given.
export const HISTOGRAM_BUCKET_COUNT = 24;

// Consistency checks — a client reporting a histogram that doesn't sum to
// its own claimed click count, or a rate beyond the envelope's own hard
// ceiling, is not just suspicious, it is DEMONSTRABLY inconsistent with its
// own numbers. A small tolerance absorbs the click that opens/closes a
// window not having a "previous" interval to bucket.
export const HISTOGRAM_SUM_TOLERANCE = 2;

// lowVariance: coefficient of variation (stddev/mean) below this, over a
// long enough, fast enough sample, is a near-metronome — human input never
// holds this tight for this many consecutive clicks.
export const CV_THRESHOLD = 0.12;
export const MIN_CLICKS_FOR_VARIANCE_SIGNAL = 40;
export const MIN_CPS_FOR_VARIANCE_SIGNAL = 5;

// metronome: the longest run of consecutive intervals within a few percent
// of the running median — a human's hand tremor breaks this up long before
// an autoclicker's fixed (or narrowly-jittered) timer does.
export const RUN_LENGTH_THRESHOLD = 30;

// narrowSupport / unimodalSpike / uniformShape: shape-of-distribution
// signals over the reported histogram — real human inter-click intervals
// spread log-normally across several buckets; a script's don't.
export const NARROW_SUPPORT_MAX_SPAN = 2;
export const UNIMODAL_SPIKE_FRACTION = 0.9;
export const UNIFORM_SKEW_THRESHOLD = 0.15;
export const UNIFORM_SPAN_MAX = 4;

// sustainedRate: an average rate above this over a full heartbeat window is
// only weight 1 — deliberately never decisive alone (two people mashing
// input together can plausibly graze it; see the plan's "CPS limits"
// decision). noFatigue looks for this holding flat across several
// consecutive windows with no human-like falloff.
export const SUSTAINED_RATE_CPS = 22;
export const NO_FATIGUE_STREAK = 5;

// singleMethodExceedsHumanLimit: unlike sustainedRate (an aggregate ceiling
// that has to accommodate several simultaneous input channels — e.g. two
// people mashing mouse + keyboard together, per the plan's CPS decision), a
// SINGLE input method (one mouse button, or one key) sustaining a high rate
// for a full heartbeat window has a much tighter human ceiling: research
// puts the credible sustained maximum for ordinary single-button clicking at
// ~14-16 CPS (Guinness World Records: 12.67 CPS official 2026 record, 14.1
// CPS 2018 record), with even the most extreme documented specialist
// technique (two-finger "butterfly" clicking on one button) topping out
// around 32 CPS verified / ~35-40 CPS theoretical (nerve-conduction-velocity
// limited) — and those are short competitive bursts, not a full minute of
// actual gameplay. Right-click and keyboard-key rates are lower still. 20
// CPS from one method alone, sustained across an entire window, is
// comfortably beyond ordinary human clicking and only weight 2 (still never
// decisive alone) to stay consistent with every other statistical signal
// here. Requires the method to account for MIN_CLICKS_FOR_VARIANCE_SIGNAL's
// worth of clicks and SINGLE_METHOD_CONCENTRATION of the window's total
// (not exactly 100%, so one stray accidental click from another input
// doesn't disqualify an otherwise single-method session).
export const SINGLE_METHOD_MAX_CPS = 20;
export const SINGLE_METHOD_CONCENTRATION = 0.95;

// A verdict needs at least this total weighted score from at least this many
// DISTINCT signal categories — raw click rate alone can never reach either
// threshold by itself.
export const MIN_SCORE_TO_FLAG = 3;
export const MIN_DISTINCT_SIGNALS_TO_FLAG = 2;

// A flagged window only becomes a strike after this many CONSECUTIVE
// flagged windows — a single borderline window is noise; a pattern is not.
// Tracked via AntiCheatState.suspicionScore, reset to 0 by any clean window.
export const SUSPICIOUS_WINDOWS_TO_STRIKE = 2;

// ---- Floating-point tolerance ---------------------------------------------
//
// Server-side token accumulators drift from float64 rounding across
// thousands of tick() additions — the drift scales with the value's own
// magnitude, not with a fixed absolute amount. A fixed epsilon alone let
// this slide as an account's numbers grew: a real production incident
// clamped (then, after enough repeats, struck) a legitimate account for a
// reported balance of 9,502,887.414624732 against a computed bound of
// 9,502,887.414622314 — an absolute overshoot of only 2.4e-6, but that is
// already 2x the old fixed 1e-6 floor. In RELATIVE terms it is ~2.5e-13,
// i.e. noise. floatTolerance scales with the larger operand so a late-game
// account gets the same effective precision headroom an early-game one
// always had, instead of tightening as balances grow.
export const FLOAT_ABS_EPSILON = 1e-6;
export const FLOAT_RELATIVE_EPSILON = 1e-9;

export function floatTolerance(...values: number[]): number {
  const magnitude = Math.max(FLOAT_ABS_EPSILON, ...values.map((v) => Math.abs(v)));
  return Math.max(FLOAT_ABS_EPSILON, magnitude * FLOAT_RELATIVE_EPSILON);
}
