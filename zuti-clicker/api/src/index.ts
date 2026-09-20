import express from "express";
import http from "http";
import router from "./router/index";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import dotenv from "dotenv";
import swaggerUi from "swagger-ui-express";
import { buildSwaggerSpec } from "./config/swagger";
import { ANTICHEAT_MODE } from "./constants/antiCheat";

dotenv.config();

const corsOriginUrls: string[] | undefined = process.env.CORS_ORIGIN_URLS?.split(",");
const corsOptions: cors.CorsOptions = {
  origin: corsOriginUrls,
  credentials: true
};

const app = express();

app.use(cors(corsOptions));
app.use(compression());
app.use(cookieParser());
app.use(bodyParser.json());

const server = http.createServer(app);

const ip: string | undefined = process.env.IP;
const port: string | undefined = process.env.PORT;
server.listen(port, () => {
  console.log(`Express.js server started on http://${ip}:${port}`);
  console.log(`API docs available at http://${ip}:${port}/docs`);
  // Printed unconditionally (not just on a mismatch/override — see
  // resolveAntiCheatMode's own warnings for those) because there is
  // otherwise NO way to tell which mode a running server actually resolved
  // to short of reading the source or tripping a detection and watching
  // what happens — exactly the confusion that cost real debugging time
  // once already (see the fix this line ships alongside).
  console.log(`ANTICHEAT_MODE resolved to "${ANTICHEAT_MODE}"`);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(buildSwaggerSpec()));
app.use("/", router());
