import { randomInt } from "crypto";
import { prisma } from "../prisma";
import { withWriteConflictRetry } from "../retry";
import { isWinningRoll, consolationMs, type SpinQuote } from "../../services/upgrader";
import {
  INT32_MAX,
  INT32_MIN,
  UPGRADER_PPM,
  UPGRADER_CONSOLATION_BOOSTER_ID,
  UPGRADER_CONSOLATION_MAX_REMAINING_MS
} from "../../constants/upgrader";

export type SpinResult =
  | {
      ok: true;
      won: boolean;
      /** The server's roll in [0, UPGRADER_PPM): the wheel lands exactly here. */
      rollPpm: number;
      winPpm: number;
      payout: number;
      /** The player's PhD balance after this spin. */
      phdCount: number;
      /** The new spin counter — the client echoes it back on PUT /save. */
      upgraderSeq: number;
      /** Present on a loss that earned one only: the consolation buff, relative to now. */
      consolation?: { boosterId: string; remainingMs: number };
    }
  | { ok: false; reason: "no_save" }
  | { ok: false; reason: "insufficient_phd"; phdCount: number }
  | { ok: false; reason: "limit_reached" };

interface LockedSave {
  id: number;
  phdCount: number;
  upgraderNet: number;
}

/**
 * Settles one spin. This is the whole anti-cheat surface for the upgrader:
 * the client sends only (stake, multiplier) — the roll, the outcome, the new
 * balance and the consolation buff are all decided and written here, so a
 * client can neither pick its own result nor skip a loss.
 *
 * `quote` must already be a valid bet (see services/upgrader.ts's quoteSpin).
 */
export async function spin(userId: number, stake: number, quote: SpinQuote): Promise<SpinResult> {
  // Retrying re-rolls, which is safe: a rolled-back transaction committed
  // nothing and the client never saw the first roll.
  return withWriteConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const now = new Date();

      // A LOCKING read, not a plain findUnique: it takes the row lock up front,
      // so concurrent spins (and a racing PUT /save) queue here and each sees
      // the balance the one before it left. A plain read would use the
      // transaction's original snapshot, which cannot see a concurrent
      // commit — a losing racer would then be told the wrong thing (and the
      // balance it reported would be stale).
      const rows = await tx.$queryRaw<LockedSave[]>`
        SELECT id, phdCount, upgraderNet FROM GameSave WHERE userId = ${userId} FOR UPDATE
      `;
      const save = rows[0];
      if (!save) return { ok: false, reason: "no_save" } as const;
      if (save.phdCount < stake) {
        return { ok: false, reason: "insufficient_phd", phdCount: save.phdCount } as const;
      }

      // Refuse a spin whose WIN would overflow either Int column — checked
      // before the roll, in plain arithmetic, so the answer never depends on
      // the roll and an out-of-range value never reaches the database.
      const winDelta = quote.payout - stake;
      if (
        save.phdCount + winDelta > INT32_MAX ||
        save.upgraderNet + winDelta > INT32_MAX ||
        save.upgraderNet - stake < INT32_MIN
      ) {
        return { ok: false, reason: "limit_reached" } as const;
      }

      const rollPpm = randomInt(0, UPGRADER_PPM);
      const won = isWinningRoll(rollPpm, quote.winPpm);
      const delta = won ? winDelta : -stake;

      // The row is already locked, so this cannot lose a race; the conditional
      // WHERE is a second, independent guarantee that the stake is covered
      // when the UPDATE actually runs, and the increments stay correct if
      // anything else ever writes the row.
      const settled = await tx.gameSave.updateMany({
        where: { id: save.id, phdCount: { gte: stake } },
        data: {
          phdCount: { increment: delta },
          upgraderNet: { increment: delta },
          upgraderSeq: { increment: 1 }
        }
      });
      if (settled.count === 0) return { ok: false, reason: "limit_reached" } as const;

      let consolation: { boosterId: string; remainingMs: number } | undefined;
      const consolationLengthMs = won ? 0 : consolationMs(stake, save.phdCount);
      if (consolationLengthMs > 0) {
        // Reuses the existing frenzy booster, so the anti-cheat ceiling for
        // production boosters (MAX_PRODUCTION_BOOSTER_MULTIPLIER) is unchanged.
        // A loss extends a running frenzy but never past the cap on remaining
        // time, and never shortens one that is already longer.
        const key = {
          gameSaveId_boosterId: {
            gameSaveId: save.id,
            boosterId: UPGRADER_CONSOLATION_BOOSTER_ID
          }
        };
        const existing = await tx.activeBooster.findUnique({ where: key });
        const existingExpiry = existing?.expiresAt.getTime() ?? 0;
        const extended = Math.min(
          Math.max(now.getTime(), existingExpiry) + consolationLengthMs,
          now.getTime() + UPGRADER_CONSOLATION_MAX_REMAINING_MS
        );
        const expiresAt = new Date(Math.max(extended, existingExpiry));

        await tx.activeBooster.upsert({
          where: key,
          create: {
            gameSaveId: save.id,
            boosterId: UPGRADER_CONSOLATION_BOOSTER_ID,
            expiresAt
          },
          update: { expiresAt }
        });
        consolation = {
          boosterId: UPGRADER_CONSOLATION_BOOSTER_ID,
          remainingMs: expiresAt.getTime() - now.getTime()
        };
      }

      const fresh = await tx.gameSave.findUniqueOrThrow({ where: { id: save.id } });
      return {
        ok: true,
        won,
        rollPpm,
        winPpm: quote.winPpm,
        payout: quote.payout,
        phdCount: fresh.phdCount,
        upgraderSeq: fresh.upgraderSeq,
        ...(consolation ? { consolation } : {})
      } as const;
    })
  );
}
