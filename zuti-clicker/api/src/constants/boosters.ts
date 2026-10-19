// Keep in sync with frontend/src/utils/gameConstants.ts's BOOSTER_DEFINITIONS.
export const BOOSTER_IDS = ["frenzy", "clickStorm", "clearance"] as const;
export type BoosterId = (typeof BOOSTER_IDS)[number];

export const BOOSTER_WEIGHTS: Record<BoosterId, number> = {
  frenzy: 4,
  clickStorm: 4,
  clearance: 3
};

export const BOOSTER_DURATION_SECS: Record<BoosterId, number> = {
  frenzy: 60,
  clickStorm: 90,
  clearance: 120
};

// The window POST /boosters/claim draws GameSave.nextBoosterAt's next value
// from, on every successful claim — this IS the "a booster can pop up
// randomly in 1-5 minutes" spawn window from the player's perspective, not a
// separate concept (see composables/useBoosters.ts on the frontend for how
// the client's cosmetic spawn schedule stays in sync with this).
export const BOOSTER_COOLDOWN_MIN_SECS = 60;
export const BOOSTER_COOLDOWN_MAX_SECS = 300;

// Boosters the Academic Career tree unlocks (an `unlockBooster` node — see
// services/careerCore.ts). Kept apart from BOOSTER_IDS so the base pool, its
// weights and durations stay exactly as they were for everyone else. Keep in
// sync with frontend/src/utils/gameConstants.ts's BOOSTER_DEFINITIONS.
//   windfall  — instant: the claim itself credits careerModifiers.windfallSecs
//               of the player's unboosted production (no ActiveBooster row).
//   critStorm — timed: +50% crit chance while active.
export const CAREER_BOOSTER_IDS = ["windfall", "critStorm"] as const;
export type CareerBoosterId = (typeof CAREER_BOOSTER_IDS)[number];
export type AnyBoosterId = BoosterId | CareerBoosterId;

export const CAREER_BOOSTER_WEIGHTS: Record<CareerBoosterId, number> = {
  windfall: 3,
  critStorm: 3
};

export const CAREER_BOOSTER_DURATION_SECS: Record<CareerBoosterId, number> = {
  windfall: 0,
  critStorm: 30
};

export const WINDFALL_BOOSTER_ID: CareerBoosterId = "windfall";
