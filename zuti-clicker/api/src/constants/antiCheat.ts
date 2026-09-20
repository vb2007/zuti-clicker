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
