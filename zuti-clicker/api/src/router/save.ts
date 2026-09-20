import express from "express";
import { loadSave, storeSave, resetSave } from "../controllers/save";
import { isAuthenticated, requireNotRestricted } from "../middlewares/index";

export default (router: express.Router) => {
  // GET is never gated by requireNotRestricted — a restricted player must
  // still be able to see their own state and the restriction countdown.
  // DELETE isn't gated either: wiping your own save grants no progress and
  // is a legitimate action even mid-restriction.
  router.get("/save", isAuthenticated, loadSave);
  router.put("/save", isAuthenticated, requireNotRestricted, storeSave);
  router.delete("/save", isAuthenticated, resetSave);
};
