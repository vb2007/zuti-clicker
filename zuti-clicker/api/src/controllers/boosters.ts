import express from "express";
import { claimBooster } from "../database/models/boosters";
import { Responses } from "../constants/responses";

/**
 * @openapi
 * /boosters/claim:
 *   post:
 *     tags:
 *       - Boosters
 *     summary: Claim a random booster, if the cooldown has elapsed
 *     description: >
 *       No request body — the server alone picks the booster and times it,
 *       so a client can never assert or extend a buff. Succeeds only when
 *       the account's cooldown (a server-side GameSave field, never exposed
 *       as an absolute time) has passed.
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       '200':
 *         description: Booster granted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClaimBoosterResponse'
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         $ref: '#/components/responses/Restricted'
 *       '404':
 *         description: No save exists yet to grant a booster against
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: The cooldown has not elapsed yet
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BoosterCooldownResponse'
 *       '500':
 *         $ref: '#/components/responses/InternalError'
 */
export const claimBoosterHandler = async (req: express.Request, res: express.Response) => {
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    const result = await claimBooster(userId);

    if (!result.ok) {
      if (result.reason === "no_save") {
        const r = Responses.BOOSTER.NO_SAVE;
        res.status(r.status).json(r.body);
        return;
      }
      const r = Responses.BOOSTER.ON_COOLDOWN;
      res.status(r.status).json({ ...r.body, nextAvailableInMs: result.nextAvailableInMs });
      return;
    }

    const r = Responses.BOOSTER.CLAIM_SUCCESS;
    res.status(r.status).json({
      ...r.body,
      boosterId: result.boosterId,
      remainingMs: result.remainingMs,
      nextAvailableInMs: result.nextAvailableInMs
    });
  } catch (error) {
    console.error("Claim booster error:", error);
    const r = Responses.BOOSTER.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};
