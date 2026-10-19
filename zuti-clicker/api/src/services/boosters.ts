// Pure booster rules for POST /boosters/claim (database/models/boosters.ts),
// pulled out of the transaction so they can be unit-tested with an injected
// RNG. Every input comes from the account's stored state — its UpgradeSave
// rows and its Academic Career nodes (as CareerModifiers) — never the request.
import {
  BOOSTER_IDS,
  BOOSTER_WEIGHTS,
  BOOSTER_DURATION_SECS,
  BOOSTER_COOLDOWN_MIN_SECS,
  BOOSTER_COOLDOWN_MAX_SECS,
  CAREER_BOOSTER_IDS,
  CAREER_BOOSTER_WEIGHTS,
  CAREER_BOOSTER_DURATION_SECS,
  type AnyBoosterId,
  type BoosterId,
  type CareerBoosterId
} from "../constants/boosters";
import {
  CONFERENCE_BADGE_DURATION_BONUS,
  DEPARTMENT_NEWSLETTER_COOLDOWN_BONUS
} from "../constants/upgrades";
import { CAREER_CAPS, type CareerModifiers } from "./careerCore";

function isCareerBoosterId(id: string): id is CareerBoosterId {
  return (CAREER_BOOSTER_IDS as readonly string[]).includes(id);
}

function weightOf(id: AnyBoosterId): number {
  return isCareerBoosterId(id) ? CAREER_BOOSTER_WEIGHTS[id] : BOOSTER_WEIGHTS[id as BoosterId];
}

/** The base three, plus every career booster this account has unlocked, in a fixed order. */
export function buildBoosterPool(mods: CareerModifiers): AnyBoosterId[] {
  return [...BOOSTER_IDS, ...CAREER_BOOSTER_IDS.filter((id) => mods.unlockedBoosters.includes(id))];
}

// Keep this algorithm in sync with frontend/src/utils/upgrades.ts's
// pickWeightedBoosterId (the guest-mode mirror of this same selection).
export function pickWeightedBoosterId(
  pool: readonly AnyBoosterId[],
  rng: () => number = Math.random
): AnyBoosterId {
  const totalWeight = pool.reduce((sum, id) => sum + weightOf(id), 0);
  let roll = rng() * totalWeight;
  for (const id of pool) {
    roll -= weightOf(id);
    if (roll < 0) return id;
  }
  // Floating-point fallback — should be unreachable, the loop above covers
  // the full [0, totalWeight) range.
  return pool[pool.length - 1]!;
}

/** A claimed booster's length: its base, lengthened by conferenceBadge and the tree. */
export function boosterDurationMs(
  boosterId: AnyBoosterId,
  ownedUpgradeIds: ReadonlySet<string>,
  mods: CareerModifiers
): number {
  const baseSecs = isCareerBoosterId(boosterId)
    ? CAREER_BOOSTER_DURATION_SECS[boosterId]
    : BOOSTER_DURATION_SECS[boosterId as BoosterId];
  const badge = ownedUpgradeIds.has("conferenceBadge") ? CONFERENCE_BADGE_DURATION_BONUS : 0;
  return baseSecs * 1000 * (1 + badge + mods.boosterDurationPct);
}

/**
 * The divisor departmentNewsletter and the tree's spawn nodes shorten the
 * cooldown by, capped (CAREER_CAPS.boosterSpawnDivisor). Mirrored by the
 * client's getBoosterSpawnDivisor for its cosmetic spawn schedule.
 */
export function boosterSpawnDivisor(
  ownedUpgradeIds: ReadonlySet<string>,
  mods: CareerModifiers
): number {
  const newsletter = ownedUpgradeIds.has("departmentNewsletter")
    ? DEPARTMENT_NEWSLETTER_COOLDOWN_BONUS
    : 0;
  return Math.min(CAREER_CAPS.boosterSpawnDivisor, 1 + newsletter + mods.boosterSpawnPct);
}

/** A fresh random cooldown, shortened by the spawn divisor, never below the floor. */
export function rollCooldownMs(
  ownedUpgradeIds: ReadonlySet<string>,
  mods: CareerModifiers,
  rng: () => number = Math.random
): number {
  const base =
    BOOSTER_COOLDOWN_MIN_SECS + rng() * (BOOSTER_COOLDOWN_MAX_SECS - BOOSTER_COOLDOWN_MIN_SECS);
  const secs = Math.max(
    CAREER_CAPS.boosterCooldownFloorSecs,
    base / boosterSpawnDivisor(ownedUpgradeIds, mods)
  );
  return secs * 1000;
}
