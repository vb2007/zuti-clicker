import { prisma } from "../prisma";
import { withWriteConflictRetry } from "../retry";
import type { GameSave } from "../../../generated/prisma/client";
import { CAREER_WINDOW_RUN_GRACE_SECS } from "../../constants/career";
import { PHD_MAX } from "../../constants/upgrader";

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
  // The spin counter the client believes is current (GameSave.upgraderSeq,
  // handed out by GET /save and POST /upgrader/spin). Never stored — it only
  // guards the write: a save made before a later wheel spin must not be able
  // to overwrite that spin's result (see upsertSave). Absent means 0, which
  // is correct for any client/account that has never spun.
  upgraderSeq?: number;
}

// The Academic Career purchase window as this write left it. `opened` is
// true when this very save detected a prestige and opened a new window.
export interface CareerWindowState {
  windowOpen: boolean;
  windowId: number;
  opened: boolean;
}

export type UpsertResult =
  | { ok: true; save: GameSave; career: CareerWindowState }
  | { ok: false; reason: "stale" }
  // held + invested PhDs would pass what phdTotal's DOUBLE holds exactly —
  // only a forged phdCount can get here (an honest one is bounded by the envelope).
  | { ok: false; reason: "phd_limit" };


interface LockedSaveRow {
  id: number;
  prestigeCount: number;
  phdCount: number;
  phdInvested: number;
  upgraderSeq: number;
  careerWindowOpen: number | boolean;
  careerWindowId: number;
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
      activeBoosters: { where: { expiresAt: { gt: now } } },
      careerNodes: true
    }
  });
};

export const upsertSave = async (userId: number, data: SaveInput): Promise<UpsertResult> => {
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
      // Create-or-update, spelled out (rather than prisma's upsert) because
      // the UPDATE must be conditional: `upgraderSeq` in its WHERE is
      // re-checked against the row's live value when the statement runs, so
      // a save that was already in flight when a wheel spin or an Academic
      // Career purchase committed matches 0 rows instead of overwriting that
      // PhD change. A first-ever save has nothing to be stale against. Two
      // first-ever saves racing each other hit the unique userId constraint
      // (P2002), which withWriteConflictRetry re-runs down the update path.
      //
      // A LOCKING read (like spin() and the career endpoints), because this
      // write also decides whether a prestige happened — and so whether to
      // open a career purchase window — by comparing against the row's stored
      // prestigeCount, and sets phdTotal from the row's phdInvested. Both must
      // be the live values, not a snapshot a concurrent purchase could move.
      // Raw rows come back with BOOLEAN as 0/1 (verified against MariaDB).
      const rows = await tx.$queryRaw<LockedSaveRow[]>`
        SELECT id, prestigeCount, phdCount, phdInvested, upgraderSeq, careerWindowOpen, careerWindowId
        FROM GameSave WHERE userId = ${userId} FOR UPDATE
      `;
      const existing = rows[0];
      let gameSave: GameSave;
      let career: CareerWindowState;
      if (!existing) {
        // A first-ever save that already carries a prestige (a guest who
        // prestiged, then registered) is a prestige like any other — one that
        // earned PhDs, like every honest prestige does.
        const opened = prestigeCreate.prestigeCount > 0 && prestigeCreate.phdCount > 0;
        gameSave = await tx.gameSave.create({
          data: {
            userId,
            tokens,
            totalTokensEarned,
            totalClicks,
            elapsedSeconds,
            ...prestigeCreate,
            phdTotal: prestigeCreate.phdCount,
            careerWindowOpen: opened,
            careerWindowId: opened ? 1 : 0,
            savedAt: now
          }
        });
        career = { windowOpen: opened, windowId: opened ? 1 : 0, opened };
      } else {
        const locked = {
          prestigeCount: Number(existing.prestigeCount),
          phdCount: Number(existing.phdCount),
          phdInvested: Number(existing.phdInvested),
          upgraderSeq: Number(existing.upgraderSeq),
          careerWindowOpen: Boolean(existing.careerWindowOpen),
          careerWindowId: Number(existing.careerWindowId)
        };
        if (locked.upgraderSeq !== (data.upgraderSeq ?? 0))
          return { ok: false, reason: "stale" } as const;

        const phdTotal = (data.phdCount ?? locked.phdCount) + locked.phdInvested;
        if (phdTotal > PHD_MAX) return { ok: false, reason: "phd_limit" } as const;

        // A new window on every detected prestige — also when one is still
        // open (a second prestige before Done): bumping the id makes the old
        // window's purchases permanent, so a refund can never undo a node
        // that was already in effect at a prestige. An honest prestige always
        // gains at least one PhD (and nothing else can lower phdCount between
        // two saves — every other PhD change is server-written and already in
        // the stored row), so a prestigeCount bump that gains none opens nothing.
        const opened =
          data.prestigeCount !== undefined &&
          data.prestigeCount > locked.prestigeCount &&
          data.phdCount !== undefined &&
          data.phdCount > locked.phdCount;
        // A save showing the new run under way ends an open window (see
        // CAREER_WINDOW_RUN_GRACE_SECS) — its purchases become permanent.
        const runStarted =
          locked.careerWindowOpen &&
          ((data.runClicks ?? 0) > 0 || (data.runSeconds ?? 0) > CAREER_WINDOW_RUN_GRACE_SECS);
        const windowUpdate = opened
          ? { careerWindowOpen: true, careerWindowId: locked.careerWindowId + 1 }
          : runStarted
            ? { careerWindowOpen: false }
            : {};

        const updated = await tx.gameSave.updateMany({
          where: { id: existing.id, upgraderSeq: data.upgraderSeq ?? 0 },
          data: {
            tokens,
            totalTokensEarned,
            totalClicks,
            elapsedSeconds,
            ...prestigeUpdate,
            phdTotal,
            ...windowUpdate,
            savedAt: now
          }
        });
        if (updated.count === 0) return { ok: false, reason: "stale" } as const;
        gameSave = await tx.gameSave.findUniqueOrThrow({ where: { id: existing.id } });
        career = {
          windowOpen: gameSave.careerWindowOpen,
          windowId: gameSave.careerWindowId,
          opened
        };
      }

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

      return { ok: true, save: gameSave, career } as const;
    })
  );
};

export const deleteSave = async (userId: number) => {
  // deleteMany is idempotent — no error if no save exists.
  // Cascade in the DB removes associated UnitSave/UpgradeSave/ActiveBooster/
  // CareerNodeSave rows.
  return prisma.gameSave.deleteMany({ where: { userId } });
};
