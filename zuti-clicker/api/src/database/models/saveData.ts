import { prisma } from "../prisma";
import { withWriteConflictRetry } from "../retry";

export interface UnitInput {
  unitId: string;
  owned: number;
}

export interface SaveInput {
  tokens: number;
  totalTokensEarned: number;
  totalClicks: number;
  elapsedSeconds: number;
  // Optional so older clients (predating the prestige system) keep working.
  // Absent means "leave whatever is already stored alone" on an update, and
  // "this run is the player's whole lifetime so far" on a first-ever save —
  // see upsertSave below.
  phdCount?: number;
  prestigeCount?: number;
  runTokensEarned?: number;
  runClicks?: number;
  runSeconds?: number;
  units: UnitInput[];
  // Optional for the same reason (predates the upgrades system). Unlike
  // `units` (always sent, always replaced wholesale), an absent `upgrades`
  // here means "leave whatever is already stored alone" — same
  // omitted-means-preserve rule as the prestige fields above.
  upgrades?: string[];
}

// A player's active booster buffs are deliberately NOT part of SaveInput —
// they can only be created/refreshed by POST /boosters/claim (see
// database/models/boosters.ts). PUT /save can neither set nor clear them.
export const getSave = async (userId: number) => {
  const now = new Date();
  return prisma.gameSave.findUnique({
    where: { userId },
    include: {
      units: true,
      upgrades: true,
      // Only ever return live buffs — an expired row is prestige-free debris
      // waiting for the next claim to overwrite it, not something a client
      // needs to know about.
      activeBoosters: { where: { expiresAt: { gt: now } } }
    }
  });
};

export const upsertSave = async (userId: number, data: SaveInput) => {
  const { tokens, totalTokensEarned, totalClicks, elapsedSeconds, units } = data;
  const now = new Date();

  // Omitted prestige fields are left out of the UPDATE entirely: a client that
  // predates the prestige system must never reset a player's PhDs to zero.
  const prestigeUpdate = {
    ...(data.phdCount !== undefined ? { phdCount: data.phdCount } : {}),
    ...(data.prestigeCount !== undefined ? { prestigeCount: data.prestigeCount } : {}),
    ...(data.runTokensEarned !== undefined ? { runTokensEarned: data.runTokensEarned } : {}),
    ...(data.runClicks !== undefined ? { runClicks: data.runClicks } : {}),
    ...(data.runSeconds !== undefined ? { runSeconds: data.runSeconds } : {})
  };

  // On create there is nothing to preserve. A client that omits the run stats
  // has, by definition, never prestiged, so its run equals its lifetime — the
  // same rule the 20260912120000 migration's backfill applied to pre-existing rows.
  const prestigeCreate = {
    phdCount: data.phdCount ?? 0,
    prestigeCount: data.prestigeCount ?? 0,
    runTokensEarned: data.runTokensEarned ?? totalTokensEarned,
    runClicks: data.runClicks ?? totalClicks,
    runSeconds: data.runSeconds ?? elapsedSeconds
  };

  // Two upsertSave() calls for the same user (two tabs autosaving, or a
  // manual "Sync" landing mid-autosave) can race inside this transaction and
  // have MariaDB report a write conflict/deadlock (Prisma P2034) — retried
  // here rather than surfaced as a 500, since the transaction itself is
  // idempotent for a given payload. See database/retry.ts.
  return withWriteConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const gameSave = await tx.gameSave.upsert({
        where: { userId },
        create: {
          userId,
          tokens,
          totalTokensEarned,
          totalClicks,
          elapsedSeconds,
          ...prestigeCreate,
          savedAt: now
        },
        update: {
          tokens,
          totalTokensEarned,
          totalClicks,
          elapsedSeconds,
          ...prestigeUpdate,
          savedAt: now
        }
      });

      await tx.unitSave.deleteMany({ where: { gameSaveId: gameSave.id } });

      if (units.length > 0) {
        await tx.unitSave.createMany({
          data: units.map((u) => ({ gameSaveId: gameSave.id, unitId: u.unitId, owned: u.owned }))
        });
      }

      // Upgrades follow the units replace-wholesale pattern, but ONLY when
      // present — an absent `upgrades` (a legacy client) must leave whatever
      // is already stored untouched, never wipe a player's purchases.
      if (data.upgrades !== undefined) {
        await tx.upgradeSave.deleteMany({ where: { gameSaveId: gameSave.id } });
        if (data.upgrades.length > 0) {
          await tx.upgradeSave.createMany({
            data: data.upgrades.map((upgradeId) => ({ gameSaveId: gameSave.id, upgradeId }))
          });
        }
      }

      return gameSave;
    })
  );
};

export const deleteSave = async (userId: number) => {
  // deleteMany is idempotent — no error if no save exists.
  // Cascade in the DB removes associated UnitSave/UpgradeSave/ActiveBooster rows.
  return prisma.gameSave.deleteMany({ where: { userId } });
};
