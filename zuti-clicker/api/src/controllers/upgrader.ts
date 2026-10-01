import express from "express";
import { spin } from "../database/models/upgrader";
import { toHundredths, quoteSpin } from "../services/upgrader";
import { INT32_MAX } from "../constants/upgrader";
import { Responses } from "../constants/responses";

/**
 * @openapi
 * /upgrader/spin:
 *   post:
 *     tags:
 *       - Upgrader
 *     summary: Stake PhDs on the wheel at a chosen multiplier
 *     description: >
 *       The server alone rolls and settles the spin — the client only says how
 *       much to stake and at what multiplier, so it can neither pick its own
 *       outcome nor skip a loss. A win pays floor(stake x multiplier) PhDs in
 *       place of the stake; a loss forfeits the stake and grants a
 *       consolation frenzy booster whose length is strictly proportional to
 *       the share of the player's PhDs that was staked (none if under a
 *       second). The win chance is min(80%, 90% x stake / payout), so the
 *       wheel never returns more than 90% on average.
 *       The returned upgraderSeq must be echoed back on PUT /save.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SpinRequest'
 *     responses:
 *       '200':
 *         description: Spin settled
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SpinResponse'
 *       '400':
 *         description: >
 *           Invalid stake or multiplier, or a bet whose payout would not
 *           exceed the stake
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Restricted'
 *       '404':
 *         description: No save exists yet to spin against
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: >
 *           Not enough PhDs (the body carries the real balance), or a win
 *           would overflow the stored totals (decided before the roll, so it
 *           never depends on luck)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InsufficientPhdResponse'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const spinHandler = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    // Validate the whole body before touching the database.
    const body: unknown = req.body;
    const { stake, multiplier } = (typeof body === "object" && body !== null ? body : {}) as {
      stake?: unknown;
      multiplier?: unknown;
    };

    if (typeof stake !== "number" || !Number.isInteger(stake) || stake < 1 || stake > INT32_MAX) {
      const r = Responses.UPGRADER.INVALID_STAKE;
      res.status(r.status).json(r.body);
      return;
    }

    const hundredths = typeof multiplier === "number" ? toHundredths(multiplier) : null;
    if (hundredths === null) {
      const r = Responses.UPGRADER.INVALID_MULTIPLIER;
      res.status(r.status).json(r.body);
      return;
    }

    const quote = quoteSpin(stake, hundredths);
    if (quote === null) {
      const r = Responses.UPGRADER.NO_GAIN;
      res.status(r.status).json(r.body);
      return;
    }

    const result = await spin(userId, stake, quote);

    if (!result.ok) {
      if (result.reason === "no_save") {
        const r = Responses.UPGRADER.NO_SAVE;
        res.status(r.status).json(r.body);
        return;
      }
      if (result.reason === "insufficient_phd") {
        const r = Responses.UPGRADER.INSUFFICIENT_PHD;
        res.status(r.status).json({ ...r.body, phdCount: result.phdCount });
        return;
      }
      const r = Responses.UPGRADER.LIMIT_REACHED;
      res.status(r.status).json(r.body);
      return;
    }

    const r = Responses.UPGRADER.SPIN_SUCCESS;
    res.status(r.status).json({
      ...r.body,
      won: result.won,
      rollPpm: result.rollPpm,
      winPpm: result.winPpm,
      payout: result.payout,
      phdCount: result.phdCount,
      upgraderSeq: result.upgraderSeq,
      ...(result.consolation ? { consolation: result.consolation } : {})
    });
  } catch (error) {
    console.error("Upgrader spin error:", error);
    const r = Responses.UPGRADER.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};
