// Pure odds and settlement maths for the upgrader (the PhD wheel). Mirrors
// api/src/services/upgrader.ts — there is no shared package between the two
// apps — and src/utils/__tests__/upgrader-parity.spec.ts cross-checks both
// copies against one shared golden-vector table, so the wheel the player sees
// can never disagree with the one the server rolls.
//
// Everything is integer arithmetic on purpose: the multiplier arrives as a
// float (100 * 4.35 === 434.99999999999994, so floor() would pay 434 instead of
// 435), is converted once to whole hundredths, and from there on stake, payout
// and chance are exact integers.
import {
  UPGRADER_RTP,
  UPGRADER_WIN_CHANCE_CAP,
  UPGRADER_MIN_MULTIPLIER_HUNDREDTHS,
  UPGRADER_MAX_MULTIPLIER_HUNDREDTHS,
  UPGRADER_PPM,
  UPGRADER_CONSOLATION_BASE_MS,
  UPGRADER_CONSOLATION_MIN_GRANT_MS,
  UPGRADER_CONSOLATION_MAX_REMAINING_MS
} from "@/utils/gameConstants";

// Integer forms of the two ratio constants, derived once so quoteSpin never
// multiplies by a float: 0.9 -> 900000 ppm, 0.8 -> 800000 ppm.
const RTP_PPM = Math.round(UPGRADER_RTP * UPGRADER_PPM);
const WIN_CHANCE_CAP_PPM = Math.round(UPGRADER_WIN_CHANCE_CAP * UPGRADER_PPM);

/**
 * Converts a multiplier to whole hundredths (x4.35 -> 435), or null when it has
 * more than 2 decimals, is not finite, or is outside the allowed range. The
 * tolerance only absorbs float representation error (4.35 * 100 is off by
 * ~6e-14); 1.005 (a genuine third decimal) is off by ~0.5 and is rejected.
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
  /** PhDs held after a win, counting the returned stake. */
  payout: number;
  /** Win chance in parts per million: a roll in [0, PPM) wins when roll < winPpm. */
  winPpm: number;
}

/**
 * Prices a spin, or returns null when it is not a valid bet: a non-integer or
 * non-positive stake, or a payout that would not exceed the stake (1 x 1.5
 * floors to 1 — a "win" that gains nothing).
 *
 * winPpm = min(cap, RTP * stake / payout), floored, so the real return is always
 * at or just under RTP, never above it.
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
 * proportional to the share of the player's PhDs that was put up, or 0 when that
 * is under the grant threshold. There is no minimum on purpose — a floor would
 * let a player with many PhDs keep frenzy up almost for free with tiny stakes.
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

export interface SpinOutcome {
  won: boolean;
  rollPpm: number;
  winPpm: number;
  payout: number;
  /** The PhD balance after the spin. */
  phdCount: number;
  /** Present on a loss that earned one only: the consolation frenzy, relative to now. */
  consolation?: { boosterId: string; remainingMs: number };
}

/**
 * A spin's full outcome for a roll already drawn — the guest-mode mirror of
 * what POST /upgrader/spin settles on the server (a guest has no server state,
 * so there is nothing to protect and the whole thing runs locally). `remaining`
 * is how long an already-running frenzy has left, which a loss extends but
 * never past the cap and never shortens.
 */
export function settleSpin(
  stake: number,
  multiplierHundredths: number,
  phdBefore: number,
  rollPpm: number,
  frenzyRemainingMs = 0
): SpinOutcome | null {
  const quote = quoteSpin(stake, multiplierHundredths);
  if (quote === null || stake > phdBefore) return null;
  const won = isWinningRoll(rollPpm, quote.winPpm);
  const base = { won, rollPpm, winPpm: quote.winPpm, payout: quote.payout };
  if (won) return { ...base, phdCount: phdBefore + quote.payout - stake };

  const lengthMs = consolationMs(stake, phdBefore);
  if (lengthMs === 0) return { ...base, phdCount: phdBefore - stake };
  const extended = Math.min(
    Math.max(0, frenzyRemainingMs) + lengthMs,
    UPGRADER_CONSOLATION_MAX_REMAINING_MS
  );
  return {
    ...base,
    phdCount: phdBefore - stake,
    consolation: { boosterId: "frenzy", remainingMs: Math.max(extended, frenzyRemainingMs) }
  };
}

/**
 * An unbiased integer in [0, UPGRADER_PPM) from the browser's CSPRNG, for guest
 * spins. Rejection sampling over a 32-bit draw avoids the modulo bias a plain
 * `% PPM` would add. (Logged-in spins are rolled by the server, never here.)
 */
export function rollPpmLocal(): number {
  const limit = 2 ** 32 - (2 ** 32 % UPGRADER_PPM);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % UPGRADER_PPM;
  }
}

// ---- Slider <-> multiplier ------------------------------------------------
// The slider is logarithmic: x1.2..x100 spans nearly two orders of magnitude,
// and on a linear scale everything useful (x1.2..x10) would be squeezed into
// the first tenth of the track.

const LOG_MIN = Math.log(UPGRADER_MIN_MULTIPLIER_HUNDREDTHS / 100);
const LOG_MAX = Math.log(UPGRADER_MAX_MULTIPLIER_HUNDREDTHS / 100);

/** Slider position t in [0, 1] -> a valid multiplier (at most 2 decimals). */
export function sliderToMultiplier(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  const raw = Math.exp(LOG_MIN + clamped * (LOG_MAX - LOG_MIN));
  const hundredths = Math.min(
    UPGRADER_MAX_MULTIPLIER_HUNDREDTHS,
    Math.max(UPGRADER_MIN_MULTIPLIER_HUNDREDTHS, Math.round(raw * 100))
  );
  return hundredths / 100;
}

/** A multiplier -> its slider position t in [0, 1]. Inverse of sliderToMultiplier. */
export function multiplierToSlider(multiplier: number): number {
  const t = (Math.log(multiplier) - LOG_MIN) / (LOG_MAX - LOG_MIN);
  return Math.min(1, Math.max(0, t));
}
