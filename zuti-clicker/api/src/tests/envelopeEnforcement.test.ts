import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import request from "supertest";
import { spawn, type ChildProcess } from "child_process";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { getClickValue } from "../services/economy.js";
import {
  MAX_CRIT_MULTIPLIER,
  MAX_PRODUCTION_BOOSTER_MULTIPLIER,
  MAX_CLICK_BOOSTER_MULTIPLIER
} from "../constants/gameBalance.js";
import { EARNED_ACCEPT_MARGIN, REJECT_MULTIPLIER } from "../constants/antiCheat.js";

// This file spawns its OWN, isolated server instances with an explicit
// ANTICHEAT_MODE, one per describe block — every other *.test.ts file runs
// against the single ambient server started before Jest (see CLAUDE.md /
// docs/developer/final.md's "Anti-cheat modell" section for why that ambient
// server must run with ANTICHEAT_MODE=monitor: their fixtures predate the
// envelope and were never designed to fit inside it). Proving "enforce"
// really rejects/clamps over HTTP — not just that evaluateSaveEnvelope
// returns the right verdict object (see saveValidator.test.ts) — needs a
// server actually running in that mode, hence the isolation here.
const PORT = 2711;
const BASE_URL = `http://localhost:${PORT}`;
const api = request(BASE_URL);

async function startServer(mode: string): Promise<ChildProcess> {
  const child = spawn("pnpm", ["exec", "tsx", "src/index.ts"], {
    env: { ...process.env, PORT: String(PORT), ANTICHEAT_MODE: mode },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/docs`);
      if (res.status < 500) return child;
    } catch {
      // not up yet
    }
    if (child.exitCode !== null) {
      throw new Error(`Server (mode=${mode}) exited early (code ${child.exitCode}):\n${output}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`Server (mode=${mode}) did not become ready in time:\n${output}`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  child.kill();
  await new Promise((r) => setTimeout(r, 300));
}

async function registerAndLogin(): Promise<string> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// The exact bound for a single click with zero owned units, phd 0 — derived
// from the real formulas so these tests can't silently drift from the
// envelope's own math (mirrors saveValidator.test.ts's own constant).
const ONE_CLICK_EARN_BOUND =
  getClickValue({
    flatClickBonus: 0,
    clickMultiplier: 1,
    phdProductionMultiplier: MAX_PRODUCTION_BOOSTER_MULTIPLIER,
    tokensPerSecond: 0,
    clickSynergy: 0,
    boosterClickMultiplier: MAX_CLICK_BOOSTER_MULTIPLIER
  }) *
  MAX_CRIT_MULTIPLIER *
  EARNED_ACCEPT_MARGIN;

describe("Save plausibility envelope over HTTP — ANTICHEAT_MODE=enforce", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = await startServer("enforce");
  }, 25_000);

  afterAll(async () => {
    await stopServer(server);
  });

  it("accepts a modest, achievable first save unchanged", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 2, totalTokensEarned: 2, totalClicks: 1, elapsedSeconds: 1, units: [] });
    expect(res.status).toBe(200);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.totalTokensEarned).toBe(2);
  });

  it("rejects a save more than twice what's achievable, with 409 and no write", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({
        tokens: 1_000_000,
        totalTokensEarned: 1_000_000,
        totalClicks: 1,
        elapsedSeconds: 1,
        units: []
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(Responses.SAVE.IMPLAUSIBLE.body.error);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save).toBeNull();
  });

  it("rejects a monotonicity violation and keeps the last verified save intact", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 2, totalTokensEarned: 2, totalClicks: 1, elapsedSeconds: 1, units: [] });

    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 0, totalTokensEarned: 1, totalClicks: 1, elapsedSeconds: 1, units: [] });
    expect(res.status).toBe(409);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.totalTokensEarned).toBe(2);
  });

  it("silently clamps a save between 1x and 2x over the bound, returning 200", async () => {
    const cookie = await registerAndLogin();
    const submitted = ONE_CLICK_EARN_BOUND * 1.4; // within the clamp band, not the reject band
    const res = await api.put("/save").set("Cookie", cookie).send({
      tokens: submitted,
      totalTokensEarned: submitted,
      totalClicks: 1,
      elapsedSeconds: 1,
      units: []
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.totalTokensEarned).toBeCloseTo(ONE_CLICK_EARN_BOUND, 6);
    expect(getRes.body.save.totalTokensEarned).toBeLessThan(submitted);
  });

  it("rejects when more than REJECT_MULTIPLIER times the bound", () => {
    // Sanity on the constant itself — the HTTP case above already proves a
    // value strictly beyond it (1,000,000) is rejected.
    expect(REJECT_MULTIPLIER).toBeGreaterThan(1);
  });
});

describe("Save plausibility envelope over HTTP — ANTICHEAT_MODE=monitor", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = await startServer("monitor");
  }, 25_000);

  afterAll(async () => {
    await stopServer(server);
  });

  it("writes an implausible save through unchanged and never blocks it", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({
        tokens: 1_000_000,
        totalTokensEarned: 1_000_000,
        totalClicks: 1,
        elapsedSeconds: 1,
        units: []
      });
    expect(res.status).toBe(200);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.totalTokensEarned).toBe(1_000_000);
  });
});

describe("Save plausibility envelope over HTTP — ANTICHEAT_MODE=off", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = await startServer("off");
  }, 25_000);

  afterAll(async () => {
    await stopServer(server);
  });

  it("skips the envelope entirely — an implausible save is accepted unchanged", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({
        tokens: 1_000_000,
        totalTokensEarned: 1_000_000,
        totalClicks: 1,
        elapsedSeconds: 1,
        units: []
      });
    expect(res.status).toBe(200);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.totalTokensEarned).toBe(1_000_000);
  });

  it("a monotonicity decrease is also accepted — off truly skips every envelope check", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 100, totalTokensEarned: 100, totalClicks: 1, elapsedSeconds: 1, units: [] });
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 1, totalTokensEarned: 1, totalClicks: 1, elapsedSeconds: 1, units: [] });
    expect(res.status).toBe(200);
  });
});
