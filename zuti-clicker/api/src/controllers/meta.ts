import express from "express";
import { API_VERSION } from "../constants/version";

/**
 * @openapi
 * /version:
 *   get:
 *     tags:
 *       - Meta
 *     summary: Get the API's currently deployed version
 *     responses:
 *       '200':
 *         description: The API version, read from package.json at startup
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VersionResponse'
 */
export const getVersion = (_req: express.Request, res: express.Response) => {
  res.status(200).json({ version: API_VERSION });
};
