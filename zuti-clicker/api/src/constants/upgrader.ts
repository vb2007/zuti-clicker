// Keep in sync with frontend/src/utils/gameConstants.ts's UPGRADER_* constants.

// Long-run return on a stake: over many spins a player gets back this share of
// what they put up, so the wheel is a risk tool, never a PhD farm.
export const UPGRADER_RTP = 0.9;

// A spin's win chance can never exceed this, however small the multiplier.
export const UPGRADER_WIN_CHANCE_CAP = 0.8;

// Multiplier range, in whole hundredths so the maths stays in integers
// (120 = x1.2, 10000 = x100). See services/upgrader.ts's toHundredths.
export const UPGRADER_MIN_MULTIPLIER_HUNDREDTHS = 120;
export const UPGRADER_MAX_MULTIPLIER_HUNDREDTHS = 10_000;

// Win chance resolution: the server rolls an integer in [0, PPM) and a spin
// wins when roll < winPpm.
export const UPGRADER_PPM = 1_000_000;

// A lost spin grants the existing "frenzy" booster. Its length scales with the
// share of the player's PhDs that was put up (stake / phdBefore of
// UPGRADER_CONSOLATION_BASE_MS), never below the minimum, and a loss can
// extend an already-running frenzy only up to the cap on remaining time — the
// anti-cheat ceiling for production boosters (MAX_PRODUCTION_BOOSTER_MULTIPLIER)
// is therefore unchanged.
export const UPGRADER_CONSOLATION_BOOSTER_ID = "frenzy";
export const UPGRADER_CONSOLATION_BASE_MS = 60_000;
export const UPGRADER_CONSOLATION_MIN_MS = 10_000;
export const UPGRADER_CONSOLATION_MAX_REMAINING_MS = 120_000;
