import express from "express";
import { buyHandler, refundHandler, closeHandler } from "../controllers/career";
import { isAuthenticated, requireNotRestricted } from "../middlewares/index";

// Buying and refunding move PhDs, so a restricted account can do neither.
// Closing the window grants nothing (like DELETE /save), so it stays open to
// a restricted account — otherwise a restriction would pin the window up.
export default (router: express.Router) => {
  router.post("/career/buy", isAuthenticated, requireNotRestricted, buyHandler);
  router.post("/career/refund", isAuthenticated, requireNotRestricted, refundHandler);
  router.post("/career/close", isAuthenticated, closeHandler);
};
