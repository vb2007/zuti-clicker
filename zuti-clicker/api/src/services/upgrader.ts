// Pure odds and settlement maths for the upgrader (the PhD wheel). Mirrored
// by frontend/src/utils/upgrader.ts — there is no shared package between the
// two apps (see CLAUDE.md's "Repo shape"), and src/tests/upgrader-parity.test.ts
// cross-checks both copies against one shared golden-vector table.
//
// Everything here is integer arithmetic on purpose. The multiplier arrives as
// a float (100 * 4.35 === 434.99999999999994, so floor() would pay 434 instead
// of 435), is converted once to whole hundredths, and from there on stake,
// payout and chance are all exact integers — server and client can never
// disagree about a single PhD.
import {
  UPGRADER_RTP,
  UPGRADER_WIN_CHANCE_CAP,
  UPGRADER_MIN_MULTIPLIER_HUNDREDTHS,
  UPGRADER_MAX_MULTIPLIER_HUNDREDTHS,
  UPGRADER_PPM,
  UPGRADER_CONSOLATION_BASE_MS,
  UPGRADER_CONSOLATION_MIN_GRANT_MS
} from "../constants/upgrader";

// Integer forms of the two ratio constants, derived once so quoteSpin never
// multiplies by a float: 0.9 -> 900000 ppm, 0.8 -> 800000 ppm.
const RTP_PPM = Math.round(UPGRADER_RTP * UPGRADER_PPM);
const WIN_CHANCE_CAP_PPM = Math.round(UPGRADER_WIN_CHANCE_CAP * UPGRADER_PPM);

/**
 * Converts a multiplier to whole hundredths (x4.35 -> 435), or null when it
 * has more than 2 decimals, is not finite, or is outside the allowed range.
 * The rounding tolerance only absorbs float representation error (4.35 * 100
 * is off by ~6e-14); 1.005 (a genuine third decimal) is off by ~0.5 and is
 * rejected.
 */
export function toHundredths(multiplier: number): number | null {
  if (typeof multiplier !== "number" || !Number.isFinite(multiplier)) return null;
  const scaled = multiplier * 100;
  const hundredths = Math.round(scaled);
  if (Math.abs(scaled - hundredths) > 1e-9) return null;
  if (
    hundredths < UPGRADER_MIN_MULTIPLIER_HUNDREDTHS ||
    hundredths > UPGRADER_MAX_MULTIPLIER_HUNDREDTHS
  ) {
    return null;
  }
  return hundredths;
}

export interface SpinQuote {
  /** PhDs the player holds after a win, counting the returned stake. */
  payout: number;
  /** Win chance in parts per million: a roll in [0, PPM) wins when roll < winPpm. */
  winPpm: number;
}

/**
 * Prices a spin, or returns null when it is not a valid bet: a non-integer or
 * non-positive stake, or a payout that would not exceed the stake (1 x 1.5
 * floors to 1 — a "win" that gains nothing).
 *
 * winPpm = min(cap, RTP * stake / payout), floored. Flooring means the real
 * return is always at or just under RTP, never above it.
 */
export function quoteSpin(stake: number, multiplierHundredths: number): SpinQuote | null {
  if (!Number.isInteger(stake) || stake < 1) return null;
  const payoutBig = (BigInt(stake) * BigInt(multiplierHundredths)) / 100n;
  const payout = Number(payoutBig);
  if (payout <= stake) return null;
  const winPpm = Math.min(
    WIN_CHANCE_CAP_PPM,
    Number((BigInt(RTP_PPM) * BigInt(stake)) / payoutBig)
  );
  return { payout, winPpm };
}

/**
 * How long a losing spin's consolation frenzy lasts, in ms: strictly
 * proportional to the share of the player's PhDs that was put up, or 0 when
 * that is under the grant threshold. There is no minimum on purpose — see
 * constants/upgrader.ts for why a floor would make frenzy farmable.
 * (stake <= phdBefore always holds for a valid spin, so the share never
 * exceeds the base.)
 */
export function consolationMs(stake: number, phdBefore: number): number {
  if (stake <= 0 || phdBefore <= 0) return 0;
  const proportional = Number(
    (BigInt(stake) * BigInt(UPGRADER_CONSOLATION_BASE_MS)) / BigInt(phdBefore)
  );
  return proportional >= UPGRADER_CONSOLATION_MIN_GRANT_MS ? proportional : 0;
}

/** True when a roll in [0, UPGRADER_PPM) wins at the given chance. */
export function isWinningRoll(roll: number, winPpm: number): boolean {
  return roll < winPpm;
}
