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
      /** Present on a loss only: the consolation buff, relative to now. */
      consolation?: { boosterId: string; remainingMs: number };
    }
  | { ok: false; reason: "no_save" }
  | { ok: false; reason: "insufficient_phd"; phdCount: number }
  | { ok: false; reason: "limit_reached" };

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

      const save = await tx.gameSave.findUnique({ where: { userId } });
      if (!save) return { ok: false, reason: "no_save" } as const;
      if (save.phdCount < stake) {
        return { ok: false, reason: "insufficient_phd", phdCount: save.phdCount } as const;
      }

      const rollPpm = randomInt(0, UPGRADER_PPM);
      const won = isWinningRoll(rollPpm, quote.winPpm);
      const delta = won ? quote.payout - stake : -stake;

      // Atomic conditional settle. The WHERE is re-checked against the row's
      // live value at UPDATE time (InnoDB locks the row for the statement),
      // so two concurrent spins can never both spend the same PhDs, and the
      // increments stay correct if a PUT /save adds prestige PhDs between the
      // read above and this write. The range guards keep both Int columns
      // from overflowing — phdCount from a huge win, upgraderNet (a signed
      // running total) from either direction.
      const settled = await tx.gameSave.updateMany({
        where: {
          id: save.id,
          phdCount: delta > 0 ? { gte: stake, lte: INT32_MAX - delta } : { gte: stake },
          upgraderNet: delta > 0 ? { lte: INT32_MAX - delta } : { gte: INT32_MIN - delta },
          upgraderSeq: { lte: INT32_MAX - 1 }
        },
        data: {
          phdCount: { increment: delta },
          upgraderNet: { increment: delta },
          upgraderSeq: { increment: 1 }
        }
      });

      if (settled.count === 0) {
        // Either a concurrent spin spent the PhDs first, or a column would
        // overflow. Re-read so the reply reflects what actually won.
        const fresh = await tx.gameSave.findUniqueOrThrow({ where: { id: save.id } });
        if (fresh.phdCount < stake) {
          return { ok: false, reason: "insufficient_phd", phdCount: fresh.phdCount } as const;
        }
        return { ok: false, reason: "limit_reached" } as const;
      }

      let consolation: { boosterId: string; remainingMs: number } | undefined;
      if (!won) {
        // Reuses the existing frenzy booster, so the anti-cheat ceiling for
        // production boosters (MAX_PRODUCTION_BOOSTER_MULTIPLIER) is unchanged.
        // A loss extends a running frenzy but never past the cap on remaining
        // time, and never shortens one that is already longer.
        const existing = await tx.activeBooster.findUnique({
          where: {
            gameSaveId_boosterId: { gameSaveId: save.id, boosterId: UPGRADER_CONSOLATION_BOOSTER_ID }
          }
        });
        const runningUntil = Math.max(now.getTime(), existing?.expiresAt.getTime() ?? 0);
        const extended = Math.min(
          runningUntil + consolationMs(stake, save.phdCount),
          now.getTime() + UPGRADER_CONSOLATION_MAX_REMAINING_MS
        );
        const expiresAt = new Date(Math.max(extended, existing?.expiresAt.getTime() ?? 0));

        await tx.activeBooster.upsert({
          where: {
            gameSaveId_boosterId: { gameSaveId: save.id, boosterId: UPGRADER_CONSOLATION_BOOSTER_ID }
          },
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
