import { withWriteConflictRetry } from "../retry";
import { withSaveTransaction } from "../saveTransaction";
import type { Prisma } from "../../../generated/prisma/client";
import {
  CAREER_NODES_BY_ID,
  careerBuyRefusal,
  refundClosure,
  type CareerBuyRefusal
} from "../../services/careerCore";

// The Academic Career tree's whole server surface: buying, refunding and
// closing the purchase window. Server-authoritative for the same reason as the
// Upgrader (database/models/upgrader.ts): every one of these moves PhDs, and
// PUT /save treats phdCount as never decreasing and bounded by what prestige
// explains. So the client only names a node; the price, the prerequisite, the
// window and the new balance are all decided and written here — and each
// change bumps upgraderSeq, so a save made before it can't overwrite it.

/** The read-only career state GET /save and every POST /career/* reply carry. */
export interface CareerState {
  windowOpen: boolean;
  windowId: number;
  phdInvested: number;
  nodes: { nodeId: string; cost: number; refundable: boolean }[];
}

type SaveWithCareer = {
  careerWindowOpen: boolean;
  careerWindowId: number;
  phdInvested: number;
  careerNodes: { nodeId: string; cost: number; boughtInWindow: number }[];
};

/**
 * A node is refundable only while the window it was bought in is still the
 * open one. Unknown ids (a node retired from the catalog) are left out — the
 * client could do nothing with them, and the PhDs they cost stay invested.
 */
export function toCareerState(save: SaveWithCareer): CareerState {
  return {
    windowOpen: save.careerWindowOpen,
    windowId: save.careerWindowId,
    phdInvested: save.phdInvested,
    nodes: save.careerNodes
      .filter((n) => CAREER_NODES_BY_ID.has(n.nodeId))
      .map((n) => ({
        nodeId: n.nodeId,
        cost: n.cost,
        refundable: save.careerWindowOpen && n.boughtInWindow === save.careerWindowId
      }))
  };
}

/** What every successful mutation returns: the new balance, spin/stale counter and tree. */
export interface CareerMutationState {
  phdCount: number;
  upgraderSeq: number;
  career: CareerState;
}

export type CareerFailure =
  | { ok: false; reason: "no_save" }
  | { ok: false; reason: "window_closed"; state: CareerMutationState }
  | { ok: false; reason: "window_changed"; state: CareerMutationState }
  | { ok: false; reason: Exclude<CareerBuyRefusal, "unknown">; state: CareerMutationState }
  | { ok: false; reason: "not_owned"; state: CareerMutationState }
  | { ok: false; reason: "not_refundable"; state: CareerMutationState };

export type BuyResult = ({ ok: true } & CareerMutationState) | CareerFailure;
export type RefundResult =
  | ({ ok: true; refundedNodeIds: string[]; phdRefunded: number } & CareerMutationState)
  | CareerFailure;
export type CloseResult = ({ ok: true } & CareerMutationState) | CareerFailure;

interface LockedRow {
  id: number;
  phdCount: number;
  phdInvested: number;
  careerWindowOpen: number | boolean;
  careerWindowId: number;
}

type Tx = Prisma.TransactionClient;

// A LOCKING read, not a plain findUnique — same reasoning as spin(): it takes
// the row lock up front, so concurrent purchases/refunds (and a racing PUT
// /save or wheel spin, which lock the same row first) queue here and each sees
// the balance and owned set the one before it left. Every writer locks
// GameSave before touching CareerNodeSave, so the lock order is consistent.
// Locked by id, never by userId (see database/saveTransaction.ts). Raw rows
// carry BOOLEAN as 0/1 (verified against MariaDB) — normalised here.
async function lockSave(tx: Tx, saveId: number | null) {
  if (saveId === null) return null;
  const rows = await tx.$queryRaw<LockedRow[]>`
    SELECT id, phdCount, phdInvested, careerWindowOpen, careerWindowId
    FROM GameSave WHERE id = ${saveId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  const nodes = await tx.careerNodeSave.findMany({
    where: { gameSaveId: row.id },
    select: { nodeId: true, cost: true, boughtInWindow: true }
  });
  return {
    id: row.id,
    phdCount: Number(row.phdCount),
    phdInvested: Number(row.phdInvested),
    windowOpen: Boolean(row.careerWindowOpen),
    windowId: Number(row.careerWindowId),
    nodes
  };
}

async function readState(tx: Tx, gameSaveId: number): Promise<CareerMutationState> {
  const save = await tx.gameSave.findUniqueOrThrow({
    where: { id: gameSaveId },
    include: { careerNodes: true }
  });
  return { phdCount: save.phdCount, upgraderSeq: save.upgraderSeq, career: toCareerState(save) };
}

/** Buys one node. `nodeId` must already be a known catalog id (validated by the controller). */
export async function buyNode(userId: number, nodeId: string): Promise<BuyResult> {
  return withWriteConflictRetry(() =>
    withSaveTransaction(userId, async (tx, saveId) => {
      const save = await lockSave(tx, saveId);
      if (!save) return { ok: false, reason: "no_save" } as const;
      if (!save.windowOpen) {
        return { ok: false, reason: "window_closed", state: await readState(tx, save.id) } as const;
      }

      const refusal = careerBuyRefusal(
        nodeId,
        save.nodes.map((n) => n.nodeId),
        save.phdCount
      );
      if (refusal !== null && refusal !== "unknown") {
        return { ok: false, reason: refusal, state: await readState(tx, save.id) } as const;
      }
      const cost = CAREER_NODES_BY_ID.get(nodeId)!.cost;

      // The row is already locked, so this cannot lose a race; the
      // conditional WHERE is a second, independent guarantee that the price
      // is covered and the window still open when the UPDATE actually runs.
      // phdTotal is written absolutely (held + invested is unchanged by a
      // purchase, but rewriting it heals a value an older API left stale).
      const settled = await tx.gameSave.updateMany({
        where: { id: save.id, phdCount: { gte: cost }, careerWindowOpen: true },
        data: {
          phdCount: { decrement: cost },
          phdInvested: { increment: cost },
          phdTotal: save.phdCount + save.phdInvested,
          upgraderSeq: { increment: 1 }
        }
      });
      if (settled.count === 0) {
        return {
          ok: false,
          reason: "insufficient_phd",
          state: await readState(tx, save.id)
        } as const;
      }

      await tx.careerNodeSave.create({
        data: { gameSaveId: save.id, nodeId, cost, boughtInWindow: save.windowId }
      });

      return { ok: true, ...(await readState(tx, save.id)) } as const;
    })
  );
}

/**
 * Refunds a node bought in the current window, together with every owned
 * descendant (they would lose their prerequisite). Each is refunded at the
 * price it was actually bought for, not the catalog's current one.
 */
export async function refundNode(userId: number, nodeId: string): Promise<RefundResult> {
  return withWriteConflictRetry(() =>
    withSaveTransaction(userId, async (tx, saveId) => {
      const save = await lockSave(tx, saveId);
      if (!save) return { ok: false, reason: "no_save" } as const;
      if (!save.windowOpen) {
        return { ok: false, reason: "window_closed", state: await readState(tx, save.id) } as const;
      }
      if (!save.nodes.some((n) => n.nodeId === nodeId)) {
        return { ok: false, reason: "not_owned", state: await readState(tx, save.id) } as const;
      }

      const removed = refundClosure(
        nodeId,
        save.nodes.map((n) => n.nodeId),
        save.nodes.filter((n) => n.boughtInWindow === save.windowId).map((n) => n.nodeId)
      );
      if (removed === null) {
        return {
          ok: false,
          reason: "not_refundable",
          state: await readState(tx, save.id)
        } as const;
      }
      const removedSet = new Set(removed);
      const phdRefunded = save.nodes
        .filter((n) => removedSet.has(n.nodeId))
        .reduce((sum, n) => sum + n.cost, 0);

      await tx.careerNodeSave.deleteMany({
        where: { gameSaveId: save.id, nodeId: { in: removed } }
      });
      await tx.gameSave.update({
        where: { id: save.id },
        data: {
          phdCount: { increment: phdRefunded },
          phdInvested: { decrement: phdRefunded },
          phdTotal: save.phdCount + save.phdInvested,
          upgraderSeq: { increment: 1 }
        }
      });

      return {
        ok: true,
        refundedNodeIds: removed,
        phdRefunded,
        ...(await readState(tx, save.id))
      } as const;
    })
  );
}

/**
 * Closes the purchase window (Skip / Done), making this window's purchases
 * permanent. Idempotent: closing an already-closed window succeeds (a double
 * Done, or a second tab). When `windowId` is given it must be the open
 * window's — a delayed close for an older window must not close a newer one.
 * Changes no PhDs, so upgraderSeq is deliberately left alone.
 */
export async function closeWindow(userId: number, windowId?: number): Promise<CloseResult> {
  return withWriteConflictRetry(() =>
    withSaveTransaction(userId, async (tx, saveId) => {
      const save = await lockSave(tx, saveId);
      if (!save) return { ok: false, reason: "no_save" } as const;
      if (save.windowOpen) {
        if (windowId !== undefined && windowId !== save.windowId) {
          return {
            ok: false,
            reason: "window_changed",
            state: await readState(tx, save.id)
          } as const;
        }
        await tx.gameSave.update({ where: { id: save.id }, data: { careerWindowOpen: false } });
      }
      return { ok: true, ...(await readState(tx, save.id)) } as const;
    })
  );
}
