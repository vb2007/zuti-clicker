import { prisma } from "../prisma";
import { WINDFALL_BOOSTER_ID, type AnyBoosterId } from "../../constants/boosters";
import {
  buildBoosterPool,
  pickWeightedBoosterId,
  boosterDurationMs,
  rollCooldownMs
} from "../../services/boosters";
import { getCareerModifiers } from "../../services/careerCore";
import { getWindfallGrant } from "../../services/economy";

export type ClaimResult =
  | {
      ok: true;
      boosterId: AnyBoosterId;
      remainingMs: number;
      nextAvailableInMs: number;
      // Windfall only: the tokens this claim credited, and the bumped
      // upgraderSeq the client must adopt (the grant changed its save).
      windfall?: { granted: number; upgraderSeq: number };
    }
  | { ok: false; reason: "no_save" }
  | { ok: false; reason: "on_cooldown"; nextAvailableInMs: number };

/**
 * Grants a random booster if — and only if — the account's cooldown
 * (GameSave.nextBoosterAt) has elapsed. This is the entire anti-cheat
 * surface for boosters: no request body is ever read, the booster type and
 * its duration are chosen here, and the new cooldown is a fresh server-side
 * random draw. A client cannot assert, choose, or extend a buff — see the
 * plan this implements.
 */
export async function claimBooster(userId: number): Promise<ClaimResult> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const save = await tx.gameSave.findUnique({
      where: { userId },
      include: { upgrades: true, units: true, careerNodes: true }
    });
    if (!save) return { ok: false, reason: "no_save" };

    if (save.nextBoosterAt > now) {
      return {
        ok: false,
        reason: "on_cooldown",
        nextAvailableInMs: save.nextBoosterAt.getTime() - now.getTime()
      };
    }

    // conferenceBadge/departmentNewsletter are read from the player's own
    // (client-asserted, but server-persisted) UpgradeSave rows — a bounded,
    // documented limitation: a forged upgrade only ever grants what could
    // have been bought legitimately, never more.
    const ownedUpgradeIds = new Set(save.upgrades.map((u) => u.upgradeId));
    // The Academic Career's booster nodes (duration, spawn rate, unlocked
    // boosters) — from the account's own stored nodes, never the request.
    const mods = getCareerModifiers(save.careerNodes.map((n) => n.nodeId));

    const boosterId = pickWeightedBoosterId(buildBoosterPool(mods));
    const isWindfall = boosterId === WINDFALL_BOOSTER_ID;
    const remainingMs = isWindfall ? 0 : boosterDurationMs(boosterId, ownedUpgradeIds, mods);
    const expiresAt = new Date(now.getTime() + remainingMs);

    const nextAvailableInMs = rollCooldownMs(ownedUpgradeIds, mods);
    const nextBoosterAt = new Date(now.getTime() + nextAvailableInMs);

    // Windfall is an instant grant the save envelope could never explain on
    // its own, so the server credits it here, from the stored state (the
    // client flushes its save first — see useBoosters), and bumps upgraderSeq
    // so a save made before this claim can't overwrite the credited tokens.
    const granted = isWindfall
      ? getWindfallGrant(
          save.units.map((u) => ({ unitId: u.unitId, owned: u.owned })),
          save.phdCount,
          mods
        )
      : 0;

    // Atomic conditional claim — this, not the read above, is what actually
    // enforces the cooldown: the WHERE clause is re-checked against the
    // row's live value at UPDATE time (InnoDB locks the row for the
    // duration of the statement), so two requests racing the read above can
    // no longer both pass. Only one updateMany can match before
    // nextBoosterAt moves into the future; the loser's count is 0.
    const claimed = await tx.gameSave.updateMany({
      where: { id: save.id, nextBoosterAt: { lte: now } },
      data: {
        nextBoosterAt,
        boostersCollected: { increment: 1 },
        ...(isWindfall
          ? {
              tokens: { increment: granted },
              totalTokensEarned: { increment: granted },
              runTokensEarned: { increment: granted },
              upgraderSeq: { increment: 1 }
            }
          : {})
      }
    });

    if (claimed.count === 0) {
      // Lost the race to a concurrent claim between the read above and this
      // write — re-read so the reported cooldown reflects what actually won,
      // not the stale value this request saw.
      const fresh = await tx.gameSave.findUniqueOrThrow({ where: { id: save.id } });
      return {
        ok: false,
        reason: "on_cooldown",
        nextAvailableInMs: Math.max(0, fresh.nextBoosterAt.getTime() - Date.now())
      };
    }

    if (isWindfall) {
      const fresh = await tx.gameSave.findUniqueOrThrow({ where: { id: save.id } });
      return {
        ok: true,
        boosterId,
        remainingMs,
        nextAvailableInMs,
        windfall: { granted, upgraderSeq: fresh.upgraderSeq }
      };
    }

    await tx.activeBooster.upsert({
      where: { gameSaveId_boosterId: { gameSaveId: save.id, boosterId } },
      create: { gameSaveId: save.id, boosterId, expiresAt },
      update: { expiresAt }
    });

    return { ok: true, boosterId, remainingMs, nextAvailableInMs };
  });
}
