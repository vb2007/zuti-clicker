import express from "express";
import { submitReport, getStatus } from "../controllers/anticheat";
import { isAuthenticated } from "../middlewares/index";

export default (router: express.Router) => {
  // Neither route is gated by requireNotRestricted — a restricted player
  // must still be able to report telemetry and see their own status.
  router.post("/anticheat/report", isAuthenticated, submitReport);
  router.get("/anticheat/status", isAuthenticated, getStatus);
};
