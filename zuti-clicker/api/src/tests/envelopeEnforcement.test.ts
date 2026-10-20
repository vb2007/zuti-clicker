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
import { prisma } from "../database/prisma.js";

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
    // A first save: rejected under its own code, and never a strike.
    expect(res.status).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.status);
    expect(res.body.code).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.body.code);
    expect(res.body.error).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.body.error);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save).toBeNull();
  });

  // Regression: a guest who registered after playing had every save rejected
  // (elapsed_exceeds_wallclock against the account's seconds-old age) and was
  // struck for it — restricted as "suspected automation" for honest play.
  describe("a guest's first save after registering", () => {
    const strikes = async (cookie: string) =>
      (await api.get("/anticheat/status").set("Cookie", cookie)).body as {
        strikeCount: number;
        isRestricted: boolean;
      };

    // Ten minutes of honest guest play, captured from the real game store
    // (3 clicks/s, greedy buying) — far longer than the account is old.
    const TEN_MINUTE_GUEST = {
      tokens: 33402.62,
      totalTokensEarned: 459923.8,
      totalClicks: 1800,
      elapsedSeconds: 600,
      runTokensEarned: 459923.8,
      runClicks: 1800,
      runSeconds: 600,
      units: [
        { unitId: "alpha", owned: 20 },
        { unitId: "beta", owned: 15 },
        { unitId: "gamma", owned: 13 },
        { unitId: "delta", owned: 7 },
        { unitId: "epsilon", owned: 1 }
      ],
      upgrades: ["chalk", "firmHandshake", "redPen", "morningCoffee", "laserPointer", "luckyGuess"]
    };

    it("is accepted unchanged, with no strike", async () => {
      const cookie = await registerAndLogin();
      const res = await api.put("/save").set("Cookie", cookie).send(TEN_MINUTE_GUEST);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);

      const saved = (await api.get("/save").set("Cookie", cookie)).body.save;
      expect(saved.elapsedSeconds).toBe(600);
      expect(saved.totalTokensEarned).toBe(TEN_MINUTE_GUEST.totalTokensEarned);
      expect(await strikes(cookie)).toMatchObject({ strikeCount: 0, isRestricted: false });
    });

    it("a forged one is refused with FIRST_SAVE_UNVERIFIABLE, logged, but never struck", async () => {
      const user = TestData.generateUser();
      await api.post("/auth/register").send(user);
      const login = await api
        .post("/auth/login")
        .send({ email: user.email, password: user.password });
      const cookie = (login.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

      const forged = { ...TEN_MINUTE_GUEST, tokens: 1e12, totalTokensEarned: 1e12 };
      for (let i = 0; i < 3; i++) {
        const res = await api.put("/save").set("Cookie", cookie).send(forged);
        expect(res.status).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.status);
        expect(res.body.code).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.body.code);
      }
      expect(await strikes(cookie)).toMatchObject({ strikeCount: 0, isRestricted: false });

      const { id } = await prisma.user.findUniqueOrThrow({
        where: { email: user.email },
        select: { id: true }
      });
      const events = await prisma.antiCheatEvent.findMany({ where: { userId: id } });
      expect(events.map((e) => [e.kind, e.severity])).toEqual([
        ["first_save_reject", "info"],
        ["first_save_reject", "info"],
        ["first_save_reject", "info"]
      ]);
      expect(await api.get("/save").set("Cookie", cookie)).toMatchObject({
        body: { save: null }
      });
    });

    // Regression (review of 1.7.1): 24-48 h of guest play used to be CLAMPED
    // to the 24 h credit and written — but the client never learns clamped
    // values, so its next save carried the unclamped playtime again, was no
    // longer a first save, and was struck. A material clamp on a first save is
    // refused instead, exactly like a reject.
    it("a first save only the clamp tier could fit (30 h of play) is refused, not written", async () => {
      const cookie = await registerAndLogin();
      const thirtyHours = { ...TEN_MINUTE_GUEST, elapsedSeconds: 30 * 3600, runSeconds: 30 * 3600 };
      const res = await api.put("/save").set("Cookie", cookie).send(thirtyHours);
      expect(res.status).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.status);
      expect(res.body.code).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.body.code);
      expect((await api.get("/save").set("Cookie", cookie)).body.save).toBeNull();
      expect(await strikes(cookie)).toMatchObject({ strikeCount: 0, isRestricted: false });
    });

    // Regression (review of 1.7.1): a save wiped by the strike ladder (strike
    // 5 deletes it) also has no stored save — it must not turn every later
    // reject on that account into a free one.
    it("an account that was struck before gets no first-save exemption", async () => {
      const user = TestData.generateUser();
      await api.post("/auth/register").send(user);
      const login = await api
        .post("/auth/login")
        .send({ email: user.email, password: user.password });
      const cookie = (login.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
      const { id } = await prisma.user.findUniqueOrThrow({
        where: { email: user.email },
        select: { id: true }
      });
      await prisma.antiCheatState.upsert({
        where: { userId: id },
        update: { strikeCount: 1 },
        create: { userId: id, strikeCount: 1 }
      });

      const res = await api
        .put("/save")
        .set("Cookie", cookie)
        .send({ ...TEN_MINUTE_GUEST, tokens: 1e12, totalTokensEarned: 1e12 });
      expect(res.status).toBe(Responses.SAVE.IMPLAUSIBLE.status);
      expect(res.body.error).toBe(Responses.SAVE.IMPLAUSIBLE.body.error);
      expect((await strikes(cookie)).strikeCount).toBe(2);
    });

    it("once a save exists, an implausible one is IMPLAUSIBLE and struck as before", async () => {
      const cookie = await registerAndLogin();
      expect((await api.put("/save").set("Cookie", cookie).send(TEN_MINUTE_GUEST)).status).toBe(
        200
      );
      const res = await api
        .put("/save")
        .set("Cookie", cookie)
        .send({ ...TEN_MINUTE_GUEST, tokens: 1e12, totalTokensEarned: 1e12 });
      expect(res.status).toBe(Responses.SAVE.IMPLAUSIBLE.status);
      expect(res.body.error).toBe(Responses.SAVE.IMPLAUSIBLE.body.error);
      expect(res.body.code).toBe(Responses.SAVE.IMPLAUSIBLE.body.code);
      expect((await strikes(cookie)).strikeCount).toBe(1);
    });
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
    // Not the first save: a first save that needs a material clamp is refused
    // instead (see "a guest's first save after registering" below).
    const seed = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 0, totalTokensEarned: 0, totalClicks: 0, elapsedSeconds: 0, units: [] });
    expect(seed.status).toBe(200);
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
