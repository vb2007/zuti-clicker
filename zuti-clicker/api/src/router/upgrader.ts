import express from "express";
import { spinHandler } from "../controllers/upgrader";
import { isAuthenticated, requireNotRestricted } from "../middlewares/index";

export default (router: express.Router) => {
  router.post("/upgrader/spin", isAuthenticated, requireNotRestricted, spinHandler);
};
