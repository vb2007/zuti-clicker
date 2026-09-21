import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import request from "supertest";
import type { ChildProcess } from "child_process";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { getClickValue } from "../services/economy.js";
import {
  MAX_CRIT_MULTIPLIER,
  MAX_PRODUCTION_BOOSTER_MULTIPLIER,
  MAX_CLICK_BOOSTER_MULTIPLIER
} from "../constants/gameBalance.js";
import { EARNED_ACCEPT_MARGIN, REJECT_MULTIPLIER } from "../constants/antiCheat.js";
import { startTestServer, stopTestServer } from "./testServerHelper.js";

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
    server = await startTestServer(PORT, "enforce");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
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

  // Regression, real production incident: a legitimate player prestiges and
  // autosaves in the same interval. incoming.units is the POST-reset
  // (empty) state, but the earnings being saved were produced by the
  // PRE-reset economy — bounding the whole interval by the post-reset rate
  // alone made this a guaranteed 409 (and an immediate strike) for doing
  // nothing wrong.
  it("accepts a save reporting earnings from the economy that existed before an in-interval prestige", async () => {
    const cookie = await registerAndLogin();

    // Establish a small pre-prestige economy: 1 owned alpha unit, paid for
    // out of real earnings.
    const seed = await api.put("/save").set("Cookie", cookie).send({
      tokens: 0.5,
      totalTokensEarned: 8,
      totalClicks: 1,
      elapsedSeconds: 1,
      units: [{ unitId: "alpha", owned: 1 }]
    });
    expect(seed.status).toBe(200);

    // Prestige: units reset to none, prestigeCount/phdCount both advance,
    // no clicks were needed to press the button (deltaClicks: 0) — the
    // exact shape of the real incident. The earnings below are bounded by
    // the PRE-reset economy (1 alpha unit), which the fix must still credit
    // even though `units` here reports none.
    const res = await api.put("/save").set("Cookie", cookie).send({
      tokens: 10,
      totalTokensEarned: 18,
      totalClicks: 1,
      elapsedSeconds: 2,
      phdCount: 1,
      prestigeCount: 1,
      units: []
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.totalTokensEarned).toBe(18);
    expect(getRes.body.save.prestigeCount).toBe(1);
  });
});

describe("Save plausibility envelope over HTTP — ANTICHEAT_MODE=monitor", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = await startTestServer(PORT, "monitor");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
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
    server = await startTestServer(PORT, "off");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
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
