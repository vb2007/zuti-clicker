import { prisma } from "../prisma";
import { Prisma } from "../../../generated/prisma/client";
import type { LeaderboardField } from "../../constants/leaderboard";

export interface LeaderboardEntry {
  rank: number;
  username: string;
  value: number;
}

export interface LeaderboardStanding {
  rank: number;
  value: number;
  hidden: boolean;
}

// A GameSave counts as visible on other players' leaderboards unless its
// owner has explicitly opted out, OR is currently serving an anti-cheat
// restriction (see the "Anti-cheat modell" section in
// docs/developer/final.md) — this is the entire leaderboard-side consequence
// of a restriction: hidden only while it's active, with no lasting exclusion
// once it expires. `settings`/`antiCheatState` are both optional 1:1
// relations, so "no row yet" (never touched Settings; never triggered
// anti-cheat) must count as visible, not excluded.
//
// The anti-cheat branch spells out every "visible" case explicitly (no row /
// null restrictedUntil / restrictedUntil in the past) rather than negating a
// single condition with NOT — `NOT: { antiCheatState: { restrictedUntil: {
// gt: now } } }` looks equivalent but isn't: MariaDB's three-valued SQL
// logic makes `restrictedUntil > now` evaluate to NULL (not FALSE) for every
// row where restrictedUntil is NULL, and `NOT NULL` is still NULL, not TRUE
// — so that version silently excluded almost every account that had ever
// merely been evaluated by the anti-cheat system, restricted or not.
// Verified empirically against the real database before landing this fix.
function visibleFilter(now: Date): Prisma.GameSaveWhereInput {
  return {
    AND: [
      { user: { OR: [{ settings: null }, { settings: { hideFromLeaderboards: false } }] } },
      {
        user: {
          OR: [
            { antiCheatState: null },
            { antiCheatState: { restrictedUntil: null } },
            { antiCheatState: { restrictedUntil: { lte: now } } }
          ]
        }
      }
    ]
  };
}

export async function getTopEntries(
  field: LeaderboardField,
  limit: number
): Promise<LeaderboardEntry[]> {
  const rows = await prisma.gameSave.findMany({
    where: visibleFilter(new Date()),
    // Tie-break on userId so ties (e.g. two players both at 0) sort the same
    // way on every request instead of depending on incidental row order.
    orderBy: [{ [field]: "desc" }, { userId: "asc" }] as Prisma.GameSaveOrderByWithRelationInput[],
    take: limit,
    select: { [field]: true, user: { select: { username: true } } } as Prisma.GameSaveSelect
  });

  return (rows as unknown as Record<string, unknown>[]).map((row, index) => ({
    rank: index + 1,
    username: (row["user"] as { username: string }).username,
    value: row[field] as number
  }));
}

export async function getViewerStanding(
  field: LeaderboardField,
  userId: number
): Promise<LeaderboardStanding | null> {
  const own = await prisma.gameSave.findUnique({
    where: { userId },
    select: {
      [field]: true,
      user: { select: { settings: { select: { hideFromLeaderboards: true } } } }
    } as Prisma.GameSaveSelect
  });
  if (!own) return null;

  const row = own as unknown as Record<string, unknown>;
  const value = row[field] as number;
  const hidden =
    ((row["user"] as { settings: { hideFromLeaderboards: boolean } | null }).settings
      ?.hideFromLeaderboards ?? false) === true;

  // Rank = 1 + (players strictly ahead, OR tied but ordered before this one
  // by the same userId tie-break getTopEntries uses) — computed among
  // visible players only, regardless of whether the viewer themself is
  // hidden, so a hidden player still learns where they'd stand. The two
  // conditions are mutually exclusive, so a single count with OR replaces
  // what would otherwise be two separate count queries.
  const ahead = await prisma.gameSave.count({
    where: {
      ...visibleFilter(new Date()),
      OR: [
        { [field]: { gt: value } },
        { [field]: { equals: value }, userId: { lt: userId } }
      ]
    } as Prisma.GameSaveWhereInput
  });

  return { rank: ahead + 1, value, hidden };
}
