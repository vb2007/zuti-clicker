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
  it("regression: a realistic sustained-autoclicker session (fractional windowMs + suspicious shape) is actually restricted end-to-end", async () => {
    const cookie = await registerAndLogin();
    const liveDigest = { ...AUTOCLICKER_DIGEST, windowMs: 60001.200000000186 };
    await api.post("/anticheat/report").set("Cookie", cookie).send(liveDigest);
    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(liveDigest);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);

    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(true);
  });

  // The scenario that motivated the singleMethodExceedsHumanLimit signal: a
  // casual auto-clicker bound to exactly one input method (commonly
  // right-click) — sustaining >20 CPS from ONE method alone is beyond even
  // the most extreme documented human clicking technique (see
  // SINGLE_METHOD_MAX_CPS's own comment), unlike the aggregate 45 CPS
  // envelope ceiling, which has to accommodate several simultaneous input
  // channels (e.g. two people mashing mouse + keyboard together).
  //
  // Deliberately shaped to isolate JUST this signal: intervals spread evenly
  // across every histogram bucket (not narrow, not a long run, not
  // unimodal) so none of lowVariance/narrowSupport/unimodalSpike/
  // uniformShape/metronome/sustainedRate fire — only
  // singleMethodExceedsHumanLimit (weight 2) does. That alone is still not
  // decisive (needs MIN_SCORE_TO_FLAG=3 from MIN_DISTINCT_SIGNALS_TO_FLAG=2
  // categories — by design, same as every other statistical signal here),
  // so one weak pointer-physics signal (weight 1, real hardware can
  // occasionally produce these) is what actually crosses the flag
  // threshold — mirroring the real incident's own second strike, which
  // combined sustainedRate with two weak signals the same way.
  const RIGHT_CLICK_AUTOCLICKER_DIGEST = {
    windowMs: 60_000,
    clicks: 1260, // exactly 21 cps from one method — over the 20 CPS human ceiling, under the 22 CPS aggregate sustainedRate threshold
    purchases: 0,
    buckets: (() => {
      // Spread evenly across all 24 buckets — wide span, low top-fraction,
      // high variance and skew (log-spaced bucket midpoints), nothing
      // resembling a fixed-interval autoclicker's usual narrow shape.
      const b = new Array(HISTOGRAM_BUCKET_COUNT).fill(52) as number[];
      b[HISTOGRAM_BUCKET_COUNT - 1] += 1259 - 52 * HISTOGRAM_BUCKET_COUNT;
      return b;
    })(),
    maxRunLength: 1, // no long run — rules out metronome
    untrustedClicks: 0,
    hiddenClicks: 0,
    droppedClicks: 0,
    integrityFlags: [] as string[],
    weakSignals: ["frozenPressure"], // the one corroborator needed to cross the flag threshold
    methodCounts: { primary: 0, secondary: 1260, enter: 0, space: 0 }
  };

  it("regression: a realistic pure-right-click autoclicker session (isolated shape, over the single-method ceiling) is restricted end-to-end", async () => {
    const cookie = await registerAndLogin();
    await api.post("/anticheat/report").set("Cookie", cookie).send(RIGHT_CLICK_AUTOCLICKER_DIGEST);
    const res = await api
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send(RIGHT_CLICK_AUTOCLICKER_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);
  });

  // Regression (found live, post-deploy): a stale cached client still
  // shipping the OLD methodCounts shape (before enter/space were split
  // out of one combined "keyboard" field) sends a well-formed but
  // differently-shaped object. This used to 400 the ENTIRE report — not
  // just skip singleMethodExceedsHumanLimit, skip every signal, including
  // ones that had nothing to do with methodCounts — because the shape
  // check lived inside the overall isValidShape/parseDigest condition.
  // Reproducing the exact incident: the SAME shape/pattern that
  // RIGHT_CLICK_AUTOCLICKER_DIGEST above proves gets restricted must still
  // work when methodCounts is shaped like an old client's.
  it("regression: a stale client's outdated methodCounts shape never blocks the OTHER signals from still restricting", async () => {
    const cookie = await registerAndLogin();
    const staleShapeDigest = {
      ...AUTOCLICKER_DIGEST, // flags on metronome/narrowSupport alone, nothing to do with methodCounts
      methodCounts: { primary: 0, secondary: 100, keyboard: 0 } // old shape — no enter/space
    };
    await api.post("/anticheat/report").set("Cookie", cookie).send(staleShapeDigest);
    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(staleShapeDigest);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);
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

  // A well-SHAPED but internally-inconsistent digest (bucket sum contradicts
  // the claimed click count) is decisive immediately, exactly like an
  // untrusted click — a self-review during this same round of fixes briefly
  // folded this into the ordinary "2 consecutive flagged windows" rule
  // instead (on the theory it deserved the same leniency as a statistical
  // signal), but that opened a real evasion: alternating one inconsistent
  // digest with one clean digest resets suspicionScore on every clean
  // window, so the pattern would never reach 2 consecutive and never
  // strike at all. Unlike an unscoreable digest (malformed shape, or a
  // window the browser suspended through — genuinely no information), a
  // digest that contradicts its own numbers has no innocent explanation.
  it("an immediate strike on a well-shaped but internally-inconsistent digest, with no repetition needed", async () => {
    const cookie = await registerAndLogin();
    const res = await api
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send({ ...CLEAN_DIGEST, clicks: 50, buckets: emptyBuckets() }); // sum(buckets)=0, claims 50 clicks
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted");
    expect(res.body.strikeCount).toBe(1);
  });

  // Regression: alternating an inconsistent digest with a clean one must
  // not let the pattern evade the strike ladder — this is exactly the
  // evasion the above test's history warns about, verified end to end.
  it("regression: alternating inconsistent and clean digests does not evade the strike (inconsistency stays decisive)", async () => {
    const cookie = await registerAndLogin();
    const inconsistentDigest = { ...CLEAN_DIGEST, clicks: 50, buckets: emptyBuckets() };

    await api.post("/anticheat/report").set("Cookie", cookie).send(inconsistentDigest);
    // If decisiveness were ever lost again, this alternation would reset
    // suspicionScore to 0 every other report and never strike.
    await api.post("/anticheat/report").set("Cookie", cookie).send(CLEAN_DIGEST);

    const status = await api.get("/anticheat/status").set("Cookie", cookie);
    expect(status.body.isRestricted).toBe(true);
    expect(status.body.strikeCount).toBe(1);
  });

  // Regression, the literal production incident ("banned for opening the
  // prestige modal for a few seconds" on iOS/WebKit): a window the
  // browser's own timer was suspended through — backgrounded tab, locked
  // screen — reports an oversized windowMs with 0 clicks. This must be
  // completely inert: no strike, not even after repetition, and it must
  // not reset a genuinely flagged streak either (see the next test).
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

  // An unscoreable window must be NEUTRAL, not "clean" — laundering a
  // flagged streak through a bogus/suspended digest would let a real
  // cheater dodge the 2-consecutive-window rule by interleaving one.
  it("an unscoreable window does not reset an in-progress suspicion streak", async () => {
    const cookie = await registerAndLogin();
    await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST); // suspicionScore -> 1
    await api
      .post("/anticheat/report")
      .set("Cookie", cookie)
      .send({ ...CLEAN_DIGEST, windowMs: 300_000, clicks: 0 }); // unscoreable, not a clean window

    const res = await api.post("/anticheat/report").set("Cookie", cookie).send(AUTOCLICKER_DIGEST);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("restricted"); // the streak survived the unscoreable window
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
