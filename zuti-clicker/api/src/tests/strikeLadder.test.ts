import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import request from "supertest";
import type { ChildProcess } from "child_process";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import {
  HISTOGRAM_BUCKET_COUNT,
  SAVE_RESET_STRIKE,
  STRIKE_DECAY_DAYS,
  SOFT_CLAMP_STRIKE_THRESHOLD,
  ANTICHEAT_STATE_WINDOW_HOURS
} from "../constants/antiCheat.js";
import { prisma } from "../database/prisma.js";
import { recordSoftClamp } from "../database/models/antiCheat.js";
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
// antiCheatDigest.test.ts). Statistical evidence only, so it is logged as
// flagged but never strikes (see processDigest).
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

// The only digest evidence that still restricts: a click the browser marked
// untrusted (a script dispatched it).
const UNTRUSTED_DIGEST = {
  windowMs: 60_000,
  clicks: 1,
  purchases: 0,
  buckets: (() => {
    const b = new Array(HISTOGRAM_BUCKET_COUNT).fill(0) as number[];
    return b;
  })(),
  maxRunLength: 0,
  untrustedClicks: 1,
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

  // Regression (production incident): windowMs is a genuine performance.now()
  // duration, sub-millisecond precision, e.g. 60001.200000000186 — this used
  // to be validated with an integer-only check, so EVERY real heartbeat from
  // EVERY logged-in user was rejected with 400 before ever reaching
  // evaluateDigest, and the statistical layer never actually ran in
  // production. Every hand-written fixture in this repo (including the ones
  // above) happens to use an integer literal for windowMs, which is exactly
  // why this went undetected until a real browser sent a real value.
  it("regression: accepts a digest with a realistic non-integer windowMs (a real performance.now() delta)", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send({ ...CLEAN_DIGEST, windowMs: 60001.200000000186 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean");
  });

  // Regression (the actual reported incident, end-to-end): the previous test
  // only proves an idle digest's shape is now accepted — it says nothing
  // about whether a REAL sustained autoclicker session, reported with the
  // same realistic non-integer windowMs a real browser sends, actually gets
  // caught. This is the literal scenario from the incident: a ~44.5 CPS
  // autoclicker held flat for two consecutive heartbeat windows.
  // Regression (2026-10-20): the statistical click-timing layer used to strike
  // after two flagged windows. A fast, steady human clicker — the leading
  // player — trips its weak signals on nearly every heartbeat, one window
  // short of a strike. Statistical evidence is now logged, never acted on.
  async function reportTwice(cookie: string, digest: object) {
    await api.post("/anticheat/report").set("Cookie", cookie).send(digest);
    return api.post("/anticheat/report").set("Cookie", cookie).send(digest);
  }

  async function digestEvents(cookie: string) {
    const me = await api.get("/auth/me").set("Cookie", cookie);
    return prisma.antiCheatEvent.findMany({
      where: { userId: me.body.user.id },
      orderBy: { id: "asc" }
    });
  }

  it("regression: a sustained autoclicker-shaped session is logged as flagged but never restricts", async () => {
    const cookie = await registerAndLogin();
    const liveDigest = { ...AUTOCLICKER_DIGEST, windowMs: 60001.200000000186 };
    for (let i = 0; i < 5; i++) {
      const res = await api.post("/anticheat/report").set("Cookie", cookie).send(liveDigest);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("clean");
    }
    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body).toMatchObject({ isRestricted: false, strikeCount: 0 });

    const events = await digestEvents(cookie);
    expect(events).toHaveLength(5);
    for (const e of events) {
      expect(e.kind).toBe("statistical_digest");
      expect(e.severity).toBe("info");
      expect(e.enforced).toBe(false);
      expect((e.detail as { flagged: boolean }).flagged).toBe(true);
    }
  });

  // An auto-clicker bound to one input method (commonly right-click),
  // sustaining over SINGLE_METHOD_MAX_CPS from it alone. Shaped to isolate
  // singleMethodExceedsHumanLimit plus one weak pointer-physics signal.
  const RIGHT_CLICK_AUTOCLICKER_DIGEST = {
    windowMs: 60_000,
    clicks: 1260, // exactly 21 cps from one method — over the 20 CPS human ceiling, under the 22 CPS aggregate sustainedRate threshold
    purchases: 0,
    buckets: (() => {
      const b = new Array(HISTOGRAM_BUCKET_COUNT).fill(52) as number[];
      b[HISTOGRAM_BUCKET_COUNT - 1] += 1259 - 52 * HISTOGRAM_BUCKET_COUNT;
      return b;
    })(),
    maxRunLength: 1,
    untrustedClicks: 0,
    hiddenClicks: 0,
    droppedClicks: 0,
    integrityFlags: [] as string[],
    weakSignals: ["frozenPressure"],
    methodCounts: { primary: 0, secondary: 1260, enter: 0, space: 0 }
  };

  it("regression: a single-method high-rate session is logged as flagged but never restricts", async () => {
    const cookie = await registerAndLogin();
    const res = await reportTwice(cookie, RIGHT_CLICK_AUTOCLICKER_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean");
    expect(res.body.strikeCount).toBe(0);
  });

  // Still accepted (never a 400) with a stale client's older methodCounts shape.
  it("a stale client's outdated methodCounts shape is still accepted and scored", async () => {
    const cookie = await registerAndLogin();
    const staleShapeDigest = {
      ...AUTOCLICKER_DIGEST,
      methodCounts: { primary: 0, secondary: 100, keyboard: 0 } // old shape — no enter/space
    };
    const res = await reportTwice(cookie, staleShapeDigest);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean");
    const events = await digestEvents(cookie);
    expect((events.at(-1)!.detail as { flagged: boolean }).flagged).toBe(true);
  });

  it("an immediate strike on any untrusted click, with no repetition needed", async () => {
    const cookie = await registerAndLogin();
    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(UNTRUSTED_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);
    const events = await digestEvents(cookie);
    expect(events.map((e) => [e.kind, e.severity])).toContainEqual(["certain_evidence", "strike"]);
  });

  it("an immediate strike on a honeypot hit", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send({ ...CLEAN_DIGEST, integrityFlags: ["honeypot:clickTrap"] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);
  });

  // Regression: browser extensions (ad-blocker scriptlets, anti-fingerprinting
  // add-ons) legitimately patch the natives this check looks at — logged only.
  it("regression: a patched native (patched:*) is logged but never restricts", async () => {
    const cookie = await registerAndLogin();
    const res = await reportTwice(cookie, {
      ...CLEAN_DIGEST,
      integrityFlags: ["patched:setInterval", "patched:dateNow"]
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("clean");
    expect(res.body.strikeCount).toBe(0);
  });

  // Regression (2026-09-21: a client digest bug struck one account four times
  // and reset its save): a digest whose own numbers disagree is a client
  // bookkeeping problem, not evidence of cheating — logged, never a strike.
  it("regression: an internally-inconsistent digest is logged but never restricts", async () => {
    const cookie = await registerAndLogin();
    const inconsistent = { ...CLEAN_DIGEST, clicks: 50, buckets: emptyBuckets() }; // sum 0, claims 50
    for (let i = 0; i < 3; i++) {
      const res = await api.post("/anticheat/report").set("Cookie", cookie).send(inconsistent);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("clean");
    }
    const events = await digestEvents(cookie);
    expect(events.map((e) => [e.kind, e.severity])).toEqual([
      ["digest_inconsistent", "info"],
      ["digest_inconsistent", "info"],
      ["digest_inconsistent", "info"]
    ]);
  });

  // Regression ("banned for opening the prestige modal for a few seconds" on
  // iOS/WebKit): a window the browser's timer was suspended through is inert.
  it("regression: an oversized windowMs (a backgrounded/suspended window) is never a strike, however many times it repeats", async () => {
    const cookie = await registerAndLogin();
    const suspendedDigest = { ...CLEAN_DIGEST, windowMs: 300_000, clicks: 0 };

    for (let i = 0; i < 5; i++) {
      const res = await api.post("/anticheat/report").set("Cookie", cookie).send(suspendedDigest);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("clean");
    }

    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(false);
    expect(status.body.strikeCount).toBe(0);
  });

  it("a restricted account is blocked from PUT /save with 403, but can still GET it", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 1, totalTokensEarned: 1, totalClicks: 1, elapsedSeconds: 1, units: [] });

    // An untrusted click forces a strike.
    await api.post("/anticheat/report").set("Cookie", cookie).send(UNTRUSTED_DIGEST);

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
    // Not the account's first save — that one is never struck (see
    // envelopeEnforcement.test.ts's "a guest's first save after registering").
    const first = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ tokens: 1, totalTokensEarned: 1, totalClicks: 1, elapsedSeconds: 1, units: [] });
    expect(first.status).toBe(200);
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
      const res = await api.post("/anticheat/report").set("Cookie", cookie).send(UNTRUSTED_DIGEST);
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

// recordSoftClamp itself (materiality gating + the rolling window) has no
// realistic HTTP reconstruction that stays both precise and readable — the
// exact overshoot magnitude needed to land a clamp just above/below the
// materiality ratio depends on the full economy formula. Called directly
// instead, exactly as controllers/save.ts calls it, against a real user
// created through the same dedicated enforce-mode server as every other
// test in this file.
describe("Anti-cheat soft-clamp pattern — materiality and window", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = await startTestServer(PORT, "enforce");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  async function registerAndGetUserId(): Promise<{ cookie: string; userId: number }> {
    const cookie = await registerAndLogin();
    const me = await api.get("/auth/me").set("Cookie", cookie);
    return { cookie, userId: me.body.user.id as number };
  }

  // Regression, real production incident: 5 consecutive clamps (the OLD
  // threshold), every one pure float64 residue, escalated to an actual
  // strike against a completely legitimate account. An immaterial clamp
  // must never count toward the pattern, however many of them pile up.
  it("regression: immaterial clamps never strike, however many accumulate", async () => {
    const { cookie, userId } = await registerAndGetUserId();
    for (let i = 0; i < SOFT_CLAMP_STRIKE_THRESHOLD + 5; i++) {
      const outcome = await recordSoftClamp(userId, "enforce", true, false, { i });
      expect(outcome).toBeNull();
    }
    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(false);
    expect(status.body.strikeCount).toBe(0);
    const state = await prisma.antiCheatState.findUnique({ where: { userId } });
    expect(state?.softClampCount).toBe(0);
  });

  it("SOFT_CLAMP_STRIKE_THRESHOLD material clamps within the window escalate to a real strike", async () => {
    const { cookie, userId } = await registerAndGetUserId();
    let lastOutcome = null;
    for (let i = 0; i < SOFT_CLAMP_STRIKE_THRESHOLD; i++) {
      lastOutcome = await recordSoftClamp(userId, "enforce", true, true, { i });
    }
    expect(lastOutcome).not.toBeNull();
    expect(lastOutcome!.strikeCount).toBe(1);
    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(true);
  });

  // Regression: the window this counter lives in previously didn't exist at
  // all — any SOFT_CLAMP_STRIKE_THRESHOLD material clamps, however far
  // apart in time, escalated. A clamp older than ANTICHEAT_STATE_WINDOW_HOURS
  // must no longer contribute to a fresh pattern.
  it("regression: material clamps older than ANTICHEAT_STATE_WINDOW_HOURS don't combine with new ones", async () => {
    const { userId } = await registerAndGetUserId();
    for (let i = 0; i < SOFT_CLAMP_STRIKE_THRESHOLD - 1; i++) {
      await recordSoftClamp(userId, "enforce", true, true, { i });
    }
    let state = await prisma.antiCheatState.findUnique({ where: { userId } });
    expect(state?.softClampCount).toBe(SOFT_CLAMP_STRIKE_THRESHOLD - 1);

    // Age the window past its expiry directly — real time can't be waited
    // out in a test.
    await prisma.antiCheatState.update({
      where: { userId },
      data: {
        softClampWindowStartedAt: new Date(
          Date.now() - (ANTICHEAT_STATE_WINDOW_HOURS * 60 * 60 * 1000 + 60_000)
        )
      }
    });

    // One more material clamp must restart the window at 1, not reach the
    // threshold the way it would if the earlier ones still counted.
    const outcome = await recordSoftClamp(userId, "enforce", true, true, {});
    expect(outcome).toBeNull();
    state = await prisma.antiCheatState.findUnique({ where: { userId } });
    expect(state?.softClampCount).toBe(1);
  });

  // Regression: recordSoftClamp used to write lastCleanAt: now() on every
  // clamp, which blocked the 30-day strike-decay clock from ever running
  // for an account that clamped at all — even a materially-over-bound but
  // still-far-from-a-strike one.
  it("a material clamp does not reset lastCleanAt (the strike-decay anchor)", async () => {
    const { userId } = await registerAndGetUserId();
    // AntiCheatState is created lazily on the first clamp — an immaterial
    // one first, itself asserted above to never touch lastCleanAt, just to
    // get a row to read a baseline from.
    await recordSoftClamp(userId, "enforce", true, false, {});
    const before = await prisma.antiCheatState.findUnique({ where: { userId } });
    await recordSoftClamp(userId, "enforce", true, true, {});
    const after = await prisma.antiCheatState.findUnique({ where: { userId } });
    expect(after?.lastCleanAt.getTime()).toBe(before?.lastCleanAt.getTime());
  });

  // Regression: decayIfDue (triggered by any anti-cheat read/write once
  // lastCleanAt is stale enough) already reset softClampCount as part of
  // wiping accumulated minor suspicion after a long clean stretch, but
  // never cleared the paired softClampWindowStartedAt introduced alongside
  // it — leaving a stale non-null timestamp next to a freshly-zeroed
  // counter, an inconsistency every OTHER writer of this pair
  // (recordSoftClamp, applyStrike) avoids.
  it("regression: strike decay also clears softClampWindowStartedAt, not just softClampCount", async () => {
    const { cookie, userId } = await registerAndGetUserId();
    const staleLastCleanAt = new Date(Date.now() - (STRIKE_DECAY_DAYS + 1) * 24 * 60 * 60 * 1000);
    const seed = { softClampCount: 3, softClampWindowStartedAt: new Date(), lastCleanAt: staleLastCleanAt };
    await prisma.antiCheatState.upsert({
      where: { userId },
      update: seed,
      create: { userId, ...seed }
    });

    await api.get("/anticheat/status").set("Cookie", cookie); // enforced — triggers and persists the decay

    const row = await prisma.antiCheatState.findUnique({ where: { userId } });
    expect(row?.softClampCount).toBe(0);
    expect(row?.softClampWindowStartedAt).toBeNull();
  });
});

describe("Anti-cheat strike decay — ANTICHEAT_MODE=monitor", () => {
  let server: ChildProcess;
  const MONITOR_PORT = 2714;
  const monitorApi = request(`http://localhost:${MONITOR_PORT}`);

  beforeAll(async () => {
    server = await startTestServer(MONITOR_PORT, "monitor");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  // Regression: decayIfDue used to persist the decayed strikeCount/
  // lastCleanAt/etc. to AntiCheatState unconditionally, even under
  // ANTICHEAT_MODE=monitor — a mode whose entire contract is "observe what
  // would happen, never mutate state". The decayED numbers must still be
  // computed and reflected in the response (monitor must still show what
  // WOULD happen), but the stored row itself must be untouched.
  it("computes decay for the response but never writes it to AntiCheatState", async () => {
    const user = TestData.generateUser();
    await monitorApi.post("/auth/register").send(user);
    const loginRes = await monitorApi
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const cookie = (loginRes.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const meRes = await monitorApi.get("/auth/me").set("Cookie", cookie);
    const userId: number = meRes.body.user.id;

    const staleLastCleanAt = new Date(Date.now() - (STRIKE_DECAY_DAYS + 1) * 24 * 60 * 60 * 1000);
    await prisma.antiCheatState.upsert({
      where: { userId },
      update: { strikeCount: 3, lastCleanAt: staleLastCleanAt },
      create: { userId, strikeCount: 3, lastCleanAt: staleLastCleanAt }
    });

    const statusRes = await monitorApi.get("/anticheat/status").set("Cookie", cookie);
    expect(statusRes.body.strikeCount).toBe(2); // one clean decay level reflected in the response...

    const row = await prisma.antiCheatState.findUnique({ where: { userId } });
    expect(row?.strikeCount).toBe(3); // ...but never persisted
    expect(row?.lastCleanAt.getTime()).toBe(staleLastCleanAt.getTime());
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
