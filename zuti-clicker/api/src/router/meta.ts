import express from "express";
import { getVersion } from "../controllers/meta";

export default (router: express.Router) => {
  router.get("/version", getVersion);
};
