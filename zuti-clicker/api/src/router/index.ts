import express from "express";

import authentication from "./authentication";
import save from "./save";
import settings from "./settings";
import leaderboard from "./leaderboard";
import boosters from "./boosters";
import anticheat from "./anticheat";

const router = express.Router();

export default (): express.Router => {
  authentication(router);
  save(router);
  settings(router);
  leaderboard(router);
  boosters(router);
  anticheat(router);

  return router;
};
