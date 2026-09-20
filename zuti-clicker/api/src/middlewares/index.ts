import express from "express";
import { getUserBySessionToken } from "../database/models/user";
import { getAntiCheatStatus } from "../database/models/antiCheat";
import { ANTICHEAT_MODE } from "../constants/antiCheat";
import { Responses } from "../constants/responses";

export const isAuthenticated = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  try {
    const sessionToken: string | undefined = req.cookies["AUTH_TOKEN"];

    if (!sessionToken) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    const authRecord = await getUserBySessionToken(sessionToken);

    if (!authRecord) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }

    req.identity = authRecord.user;
    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    const r = Responses.AUTH.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};

/**
 * Blocks every progress-affecting write while an account is under an active
 * anti-cheat restriction (PUT /save, POST /boosters/claim — see router/*.ts
 * for exactly which routes chain this after isAuthenticated). GET /save is
 * deliberately NOT gated: a restricted player must still be able to see
 * their own state and the countdown.
 *
 * A no-op outside ANTICHEAT_MODE=enforce — restrictions are only ever
 * written to AntiCheatState when a strike is actually enforced (see
 * database/models/antiCheat.ts's applyStrike), so "monitor"/"off" never have
 * a real restriction to block on in the first place; checking the mode here
 * too avoids a redundant query on every request in the common (off) case.
 */
export const requireNotRestricted = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (ANTICHEAT_MODE !== "enforce") {
    next();
    return;
  }
  try {
    const userId = req.identity?.id;
    if (userId === undefined) {
      const r = Responses.AUTH.UNAUTHORIZED;
      res.status(r.status).json(r.body);
      return;
    }
    const status = await getAntiCheatStatus(userId);
    if (status.isRestricted) {
      const r = Responses.ANTICHEAT.RESTRICTED;
      res.status(r.status).json({
        ...r.body,
        restrictedUntil: status.restrictedUntil,
        strikeCount: status.strikeCount
      });
      return;
    }
    next();
  } catch (error) {
    console.error("Anti-cheat restriction check error:", error);
    const r = Responses.ANTICHEAT.INTERNAL_ERROR;
    res.status(r.status).json(r.body);
  }
};
