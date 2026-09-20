import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import request from "supertest";
import type { ChildProcess } from "child_process";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { HISTOGRAM_BUCKET_COUNT, SAVE_RESET_STRIKE } from "../constants/antiCheat.js";
import { startTestServer, stopTestServer } from "./testServerHelper.js";

// A dedicated ANTICHEAT_MODE=enforce server (own port — see
// envelopeEnforcement.test.ts's shared testServerHelper) so the strike
// ladder's actual restriction/reset side effects can be observed over HTTP,
// independent of whatever mode the ambient server used by every other
// *.test.ts file happens to run in.
const PORT = 2712;
const BASE_URL = `http://localhost:${PORT}`;
const api = request(BASE_URL);

async function registerAndLogin(): Promise<string> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

function emptyBuckets(): number[] {
  return new Array(HISTOGRAM_BUCKET_COUNT).fill(0) as number[];
}

// A flat, fixed-interval "autoclicker" digest — flags every one of
// narrowSupport/lowVariance/metronome/unimodalSpike (see
// antiCheatDigest.test.ts). Not a zero-false-positive signal (no
// untrustedClicks/integrityFlags), so it needs SUSPICIOUS_WINDOWS_TO_STRIKE
// consecutive reports before actually striking — this fixture is sent in
// pairs throughout this file for exactly that reason.
const AUTOCLICKER_DIGEST = {
  windowMs: 5_000,
  clicks: 100,
  purchases: 0,
  buckets: (() => {
    const b = emptyBuckets();
    b[3] = 99; // a plausible "fast interval" bucket index — exact index doesn't matter, only that it's all one bucket
    return b;
  })(),
  maxRunLength: 99,
  untrustedClicks: 0,
  hiddenClicks: 0,
  droppedClicks: 0,
  integrityFlags: [] as string[],
  weakSignals: [] as string[]
};

const CLEAN_DIGEST = {
  windowMs: 60_000,
  clicks: 0,
  purchases: 0,
  buckets: emptyBuckets(),
  maxRunLength: 0,
  untrustedClicks: 0,
  hiddenClicks: 0,
  droppedClicks: 0,
  integrityFlags: [] as string[],
  weakSignals: [] as string[]
};

describe("Anti-cheat report/status and strike ladder — ANTICHEAT_MODE=enforce", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = await startTestServer(PORT, "enforce");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  it("GET /anticheat/status is clean for a brand-new account", async () => {
    const cookie = await registerAndLogin();
    const res = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isRestricted: false, restrictedUntil: null, strikeCount: 0 });
  });

  it("a clean digest is accepted and never restricts", async () => {
    const cookie = await registerAndLogin();
    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(CLEAN_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean");
  });

  it("rejects a malformed digest with 400", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send({ ...CLEAN_DIGEST, buckets: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.ANTICHEAT.INVALID_DIGEST.body.error);
  });

  it("a single flagged (non-decisive) digest is not enough to strike on its own", async () => {
    const cookie = await registerAndLogin();
    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean"); // suspicionScore is now 1, not yet 2

    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(false);
  });

  it("two CONSECUTIVE flagged digests escalate to a real strike", async () => {
    const cookie = await registerAndLogin();
    await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);

    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(true);
    expect(status.body.strikeCount).toBe(1);
  });

  it("a clean digest in between resets the suspicion streak (self-healing)", async () => {
    const cookie = await registerAndLogin();
    await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
    await api.post("/anticheat/report").set("Cookie", cookie).send(CLEAN_DIGEST);
    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean"); // the clean report in between reset the streak to 0
  });

  it("an immediate strike on any untrusted click, with no repetition needed", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send({ ...CLEAN_DIGEST, clicks: 1, untrustedClicks: 1 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);
  });

  it("a restricted account is blocked from PUT /save with 403, but can still GET it", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 1, totalTokensEarned: 1, totalClicks: 1, elapsedSeconds: 1, units: [] });

    // Two consecutive flagged windows to force a strike.
    await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
    await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);

    const putRes = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 2, totalTokensEarned: 2, totalClicks: 2, elapsedSeconds: 2, units: [] });
    expect(putRes.status).toBe(403);
    expect(putRes.body.error).toBe(Responses.ANTICHEAT.RESTRICTED.body.error);
    expect(typeof putRes.body.restrictedUntil).toBe("string");
    expect(putRes.body.strikeCount).toBe(1);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.save.tokens).toBe(1); // the pre-restriction save, untouched

    const boosterRes = await api.post("/boosters/claim").set("Cookie", cookie);
    expect(boosterRes.status).toBe(403);
  });

  it("an envelope reject on PUT /save also strikes immediately, no repetition needed", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({
        tokens: 1_000_000,
        totalTokensEarned: 1_000_000,
        totalClicks: 1,
        elapsedSeconds: 1,
        units: []
      });

    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(true);
    expect(status.body.strikeCount).toBe(1);
  });

  it("the restriction duration escalates with each additional strike, and strike 5 resets the save", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 5, totalTokensEarned: 5, totalClicks: 1, elapsedSeconds: 1, units: [] });

    const durations: number[] = [];
    for (let strike = 1; strike <= SAVE_RESET_STRIKE; strike++) {
      await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
      const res = await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
      expect(res.body.strikeCount).toBe(strike);
      durations.push(new Date(res.body.restrictedUntil).getTime() - Date.now());
    }

    // Strictly increasing (or at least non-decreasing) restriction length —
    // this is the actual "make cheating not worth it" escalation, not just
    // a strike counter going up.
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThanOrEqual(durations[i - 1]! - 2000); // small clock-skew tolerance
    }
    expect(durations[durations.length - 1]).toBeGreaterThan(durations[0]!);

    const saveRes = await api.get("/save").set("Cookie", cookie);
    expect(saveRes.body.save).toBeNull(); // strike 5 deleted it
  });
});

describe("Anti-cheat report — ANTICHEAT_MODE=off", () => {
  let server: ChildProcess;
  const OFF_PORT = 2713;
  const offApi = request(`http://localhost:${OFF_PORT}`);

  beforeAll(async () => {
    server = await startTestServer(OFF_PORT, "off");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  it("always reports clean and never restricts, regardless of content", async () => {
    const user = TestData.generateUser();
    await offApi.post("/auth/register").send(user);
    const loginRes = await offApi
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const cookie = (loginRes.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    const res = await offApi
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send({ ...CLEAN_DIGEST, clicks: 1, untrustedClicks: 999 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean");

    const status = await offApi.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(false);
  });
});
