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

// The most PhDs one spin may stake. Kept at the old INT limit even though
// the PhD columns are now DOUBLE: quoteSpin's integer maths (stake x
// hundredths, then BigInt for the chance) is proven exact up to here (see
// upgraderMath.test.ts), and a whale simply spins in chunks.
export const UPGRADER_MAX_STAKE = 2_147_483_647;
// The limits every stored PhD value is bound by: GameSave.phdCount /
// upgraderNet / phdTotal are DOUBLE columns holding whole numbers, exact up to
// 2^53 (see the widen_phd_columns migration).
export const PHD_MAX = Number.MAX_SAFE_INTEGER;
export const PHD_MIN = -Number.MAX_SAFE_INTEGER;

// Win chance resolution: the server rolls an integer in [0, PPM) and a spin
// wins when roll < winPpm.
export const UPGRADER_PPM = 1_000_000;

// A lost spin grants the existing "frenzy" booster. Its length is strictly
// proportional to the share of the player's PhDs that was put up
// (stake / phdBefore of UPGRADER_CONSOLATION_BASE_MS). Deliberately NO minimum
// length: with one, a tiny stake would buy the same buff as a big one, and a
// player with many PhDs could keep frenzy (x7 production) up almost for free by
// spinning 1 PhD over and over. Strictly proportional means the expected PhD
// cost per second of frenzy depends only on the size of the player's stack, so
// there is nothing to farm. A buff shorter than the grant threshold is not
// worth showing and is not granted at all. A loss can extend an
// already-running frenzy only up to the cap on remaining time — the anti-cheat
// ceiling for production boosters (MAX_PRODUCTION_BOOSTER_MULTIPLIER) is
// therefore unchanged.
export const UPGRADER_CONSOLATION_BOOSTER_ID = "frenzy";
export const UPGRADER_CONSOLATION_BASE_MS = 60_000;
export const UPGRADER_CONSOLATION_MIN_GRANT_MS = 1_000;
export const UPGRADER_CONSOLATION_MAX_REMAINING_MS = 120_000;
