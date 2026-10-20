import express from "express";
import { buyNode, refundNode, closeWindow, type CareerFailure } from "../database/models/career";
import { isKnownCareerNodeId } from "../services/careerCore";
import { Responses } from "../constants/responses";

const INT32_MAX = 2147483647;

function bodyOf(req: express.Request): Record<string, unknown> {
  const body: unknown = req.body;
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

// Every failure but no_save carries the account's real state, so a client
// that was out of date (another tab bought or closed meanwhile) can resync.
function sendFailure(res: express.Response, failure: CareerFailure): void {
  if (failure.reason === "no_save") {
    const r = Responses.CAREER.NO_SAVE;
    res.status(r.status).json(r.body);
    return;
  }
  const r = {
    window_closed: Responses.CAREER.WINDOW_CLOSED,
    window_changed: Responses.CAREER.WINDOW_CHANGED,
    already_owned: Responses.CAREER.ALREADY_OWNED,
    prerequisite_missing: Responses.CAREER.PREREQUISITE_MISSING,
    insufficient_phd: Responses.CAREER.INSUFFICIENT_PHD,
    not_owned: Responses.CAREER.NOT_OWNED,
    not_refundable: Responses.CAREER.NOT_REFUNDABLE
  }[failure.reason];
  res.status(r.status).json({ ...r.body, ...failure.state });
}

/**
 * @openapi
 * /career/buy:
 *   post:
 *     tags:
 *       - Career
 *     summary: Buy one Academic Career node with PhDs
 *     description: >
 *       Only while the purchase window a prestige opened is still open. The
 *       server alone checks the price, the prerequisite and the window, and
 *       settles the purchase: phdCount drops by the node's cost, phdInvested
 *       rises by it, and upgraderSeq is bumped (echo it back on PUT /save).
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CareerNodeRequest'
 *     responses:
 *       '200':
 *         description: Node bought
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CareerMutationResponse'
 *       '400':
 *         description: Unknown or missing nodeId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Restricted'
 *       '404':
 *         description: No save exists yet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: >
 *           The window is closed, the node is already owned, its prerequisite
 *           isn't, or there aren't enough PhDs. The body carries a `code` and
 *           the account's real career state.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CareerErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const buyHandler = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }
    const { nodeId } = bodyOf(req);
    if (!isKnownCareerNodeId(nodeId)) {
      const r = Responses.CAREER.INVALID_NODE;
      res.status(r.status).json(r.body);
      return;
    }

    const result = await buyNode(userId, nodeId);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    const { ok: _ok, ...state } = result;
    const r = Responses.CAREER.BUY_SUCCESS;
    res.status(r.status).json({ ...r.body, ...state });
  } catch (error) {
    console.error("Career buy error:", error);
    const r = Responses.CAREER.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};

/**
 * @openapi
 * /career/refund:
 *   post:
 *     tags:
 *       - Career
 *     summary: Refund a node bought in the current purchase window
 *     description: >
 *       Refunds the node and every owned node that branches from it (they
 *       would lose their prerequisite), each at the price actually paid. Only
 *       nodes bought since the latest prestige, while its window is open, can
 *       be refunded. Bumps upgraderSeq.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CareerNodeRequest'
 *     responses:
 *       '200':
 *         description: Nodes refunded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CareerRefundResponse'
 *       '400':
 *         description: Unknown or missing nodeId
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Restricted'
 *       '404':
 *         description: No save exists yet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: The window is closed, or the node isn't owned or isn't refundable
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CareerErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const refundHandler = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }
    const { nodeId } = bodyOf(req);
    if (!isKnownCareerNodeId(nodeId)) {
      const r = Responses.CAREER.INVALID_NODE;
      res.status(r.status).json(r.body);
      return;
    }

    const result = await refundNode(userId, nodeId);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    const { ok: _ok, ...state } = result;
    const r = Responses.CAREER.REFUND_SUCCESS;
    res.status(r.status).json({ ...r.body, ...state });
  } catch (error) {
    console.error("Career refund error:", error);
    const r = Responses.CAREER.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};

/**
 * @openapi
 * /career/close:
 *   post:
 *     tags:
 *       - Career
 *     summary: Close the purchase window (Skip / Done)
 *     description: >
 *       Makes this window's purchases permanent. Idempotent — closing an
 *       already-closed window succeeds. With windowId, refuses (409) to close
 *       a newer window than the one the client was showing. Allowed while
 *       restricted (it grants nothing). Does not bump upgraderSeq.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CareerCloseRequest'
 *     responses:
 *       '200':
 *         description: Window closed (or already was)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CareerMutationResponse'
 *       '400':
 *         description: windowId present but not a non-negative integer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '404':
 *         description: No save exists yet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: A newer window has opened since the one being closed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CareerErrorResponse'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const closeHandler = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }
    const { windowId } = bodyOf(req);
    if (
      windowId !== undefined &&
      !(
        typeof windowId === "number" &&
        Number.isInteger(windowId) &&
        windowId >= 0 &&
        windowId <= INT32_MAX
      )
    ) {
      const r = Responses.CAREER.INVALID_WINDOW_ID;
      res.status(r.status).json(r.body);
      return;
    }

    const result = await closeWindow(userId, windowId);
    if (!result.ok) {
      sendFailure(res, result);
      return;
    }
    const { ok: _ok, ...state } = result;
    const r = Responses.CAREER.CLOSE_SUCCESS;
    res.status(r.status).json({ ...r.body, ...state });
  } catch (error) {
    console.error("Career close error:", error);
    const r = Responses.CAREER.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};
