import { prisma } from "./prisma";
import type { Prisma } from "../../generated/prisma/client";

// Every writer that row-locks GameSave (PUT /save, a wheel spin, a booster
// claim, the career endpoints) locks it by PRIMARY KEY, through this helper —
// never with `WHERE userId = ? FOR UPDATE`. That locking read is a plain
// record lock only while the row exists: for a user with no save yet, InnoDB
// takes a GAP lock on the userId index instead, and that blocks every OTHER
// user's first GameSave insert landing in the same gap until the transaction
// ends (verified against MariaDB: an unrelated user's create waited out the
// whole 3 s the gap was held). With the small connection pool, a handful of
// first-ever saves stalled that way starves every other request.
//
// So the save's id is looked up first, OUTSIDE the transaction. Not as a
// plain read inside it: the first plain read in a REPEATABLE READ transaction
// fixes its snapshot, so reads made after taking the lock would then miss
// whatever the previous lock holder committed. A save's id never changes, so
// an id read a moment before the transaction is still the right row — `fn`
// locks it with `SELECT … WHERE id = ${saveId} FOR UPDATE` and must still
// handle that returning no row (the account was deleted in between).
export async function withSaveTransaction<T>(
  userId: number,
  fn: (tx: Prisma.TransactionClient, saveId: number | null) => Promise<T>
): Promise<T> {
  const found = await prisma.gameSave.findUnique({ where: { userId }, select: { id: true } });
  return prisma.$transaction((tx) => fn(tx, found?.id ?? null));
}
