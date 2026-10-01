import { describe, it, beforeAll, expect } from "@jest/globals";
import request from "supertest";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { consolationMs } from "../services/upgrader.js";
import {
  UPGRADER_PPM,
  UPGRADER_WIN_CHANCE_CAP,
  UPGRADER_CONSOLATION_MIN_GRANT_MS,
  UPGRADER_CONSOLATION_MAX_REMAINING_MS
} from "../constants/upgrader.js";

const api = request(TestData.BASE_URL);

async function registerAndLogin(): Promise<string> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// The shared server runs in "monitor" mode (see testServerHelper.ts), which
// logs but never clamps or rejects — so a test can seed any PhD balance
// directly through PUT /save without having to actually prestige.
async function userWithPhds(phdCount: number): Promise<string> {
  const cookie = await registerAndLogin();
  const res = await api
    .put("/save")
    .set("Cookie", cookie)
    .send({ ...TestData.VALID_SAVE, phdCount, prestigeCount: 5 });
  expect(res.status).toBe(200);
  return cookie;
}

const spin = (cookie: string, body: unknown) =>
  api.post("/upgrader/spin").set("Cookie", cookie).send(body as object);

describe("Upgrader endpoint - unauthenticated / no save", () => {
  it("POST /upgrader/spin returns 401 without a session", async () => {
    const res = await api.post("/upgrader/spin").send({ stake: 10, multiplier: 2 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe(Responses.AUTH.UNAUTHORIZED.body.error);
  });

  it("returns 404 for a logged-in user with no save", async () => {
    const cookie = await registerAndLogin();
    const res = await spin(cookie, { stake: 10, multiplier: 2 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe(Responses.UPGRADER.NO_SAVE.body.error);
  });
});

describe("Upgrader endpoint - request validation", () => {
  let cookie: string;
  beforeAll(async () => {
    cookie = await userWithPhds(1000);
  });

  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -5],
    ["fractional", 1.5],
    ["a numeric string", "10"],
    ["null", null],
    ["above the INT32 limit", 2_147_483_648]
  ])("rejects a stake that is %s with 400 INVALID_STAKE", async (_label, stake) => {
    const res = await spin(cookie, { stake, multiplier: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.UPGRADER.INVALID_STAKE.body.error);
  });

  it.each([
    ["missing", undefined],
    ["below the minimum", 1.19],
    ["x1", 1],
    ["above the maximum", 100.01],
    ["a third decimal", 1.005],
    ["negative", -2],
    ["a numeric string", "2"],
    ["null", null]
  ])("rejects a multiplier that is %s with 400 INVALID_MULTIPLIER", async (_label, multiplier) => {
    const res = await spin(cookie, { stake: 10, multiplier });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.UPGRADER.INVALID_MULTIPLIER.body.error);
  });

  it("rejects a bet whose payout would not exceed the stake with 400 NO_GAIN", async () => {
    // floor(1 * 1.5) === 1: a "win" that gains nothing.
    const res = await spin(cookie, { stake: 1, multiplier: 1.5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.UPGRADER.NO_GAIN.body.error);
  });

  it("rejects an absent or non-object body", async () => {
    const res = await api.post("/upgrader/spin").set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("changes nothing when validation fails (validate-then-write)", async () => {
    await spin(cookie, { stake: 10, multiplier: 1.19 });
    await spin(cookie, { stake: 0, multiplier: 2 });
    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(1000);
  });
});

describe("Upgrader endpoint - insufficient PhDs", () => {
  it("returns 409 with the real balance and spends nothing", async () => {
    const cookie = await userWithPhds(50);
    const res = await spin(cookie, { stake: 51, multiplier: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(Responses.UPGRADER.INSUFFICIENT_PHD.body.error);
    expect(res.body.phdCount).toBe(50);
    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(50);
  });

  it("allows staking exactly the whole balance", async () => {
    const cookie = await userWithPhds(10);
    const res = await spin(cookie, { stake: 10, multiplier: 2 });
    expect(res.status).toBe(200);
  });
});

describe("Upgrader endpoint - settlement", () => {
  // The server's RNG can't be forced from here, so every assertion is an
  // invariant that holds for BOTH outcomes: the new balance always equals the
  // old one plus the signed delta the response itself implies, the roll and
  // the verdict always agree, and a loss always (and only a loss) carries a
  // consolation buff.
  it("keeps balance, roll and verdict consistent across a run of spins", async () => {
    const cookie = await userWithPhds(1_000_000);
    let balance = 1_000_000;
    let seq = 0;
    let wins = 0;
    let losses = 0;

    for (let i = 0; i < 40; i++) {
      // Alternate a likely win (x1.2, 75%) and a likely loss (x100, ~0.9%).
      // 20,000 of ~1M PhDs is a 2% stake: a long enough consolation to be granted.
      const multiplier = i % 2 === 0 ? 1.2 : 100;
      const stake = 20_000;
      const balanceBefore = balance;
      const res = await spin(cookie, { stake, multiplier });
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(Responses.UPGRADER.SPIN_SUCCESS.body.message);

      expect(Number.isInteger(res.body.rollPpm)).toBe(true);
      expect(res.body.rollPpm).toBeGreaterThanOrEqual(0);
      expect(res.body.rollPpm).toBeLessThan(UPGRADER_PPM);
      expect(res.body.winPpm).toBeGreaterThan(0);
      expect(res.body.winPpm).toBeLessThanOrEqual(UPGRADER_WIN_CHANCE_CAP * UPGRADER_PPM);
      expect(res.body.won).toBe(res.body.rollPpm < res.body.winPpm);

      balance += res.body.won ? res.body.payout - stake : -stake;
      expect(res.body.phdCount).toBe(balance);
      expect(res.body.upgraderSeq).toBe(++seq);

      if (res.body.won) {
        wins++;
        expect(res.body.consolation).toBeUndefined();
      } else {
        losses++;
        // The shared maths is the oracle for whether, and how long, a buff is
        // granted — in BOTH directions: an occasional lucky x100 win can swell
        // the balance until a stake is under the grant threshold, and a loss
        // then correctly earns nothing.
        const expected = consolationMs(stake, balanceBefore);
        if (expected === 0) {
          expect(res.body.consolation).toBeUndefined();
        } else {
          expect(expected).toBeGreaterThanOrEqual(UPGRADER_CONSOLATION_MIN_GRANT_MS);
          expect(res.body.consolation.boosterId).toBe("frenzy");
          expect(res.body.consolation.remainingMs).toBeGreaterThanOrEqual(
            Math.min(expected, UPGRADER_CONSOLATION_MAX_REMAINING_MS) - 50
          );
          expect(res.body.consolation.remainingMs).toBeLessThanOrEqual(
            UPGRADER_CONSOLATION_MAX_REMAINING_MS
          );
        }
      }
    }
    // Both branches really ran (x1.2 wins 75% of 20, x100 loses ~99% of 20).
    expect(wins).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(balance);
  });

  it("a loss shows up as an active frenzy booster on GET /save", async () => {
    const cookie = await userWithPhds(10_000);
    let lost = false;
    let balance = 10_000;
    // Half the current stack each time: a 30s consolation on a loss.
    for (let i = 0; i < 10 && !lost; i++) {
      const res = await spin(cookie, { stake: Math.floor(balance / 2), multiplier: 100 });
      expect(res.status).toBe(200);
      balance = res.body.phdCount;
      lost = !res.body.won;
    }
    expect(lost).toBe(true);
    const save = await api.get("/save").set("Cookie", cookie);
    const frenzy = (
      save.body.save.activeBoosters as { boosterId: string; remainingMs: number }[]
    ).find((b) => b.boosterId === "frenzy");
    expect(frenzy).toBeDefined();
    expect(frenzy!.remainingMs).toBeGreaterThan(0);
  });

  it("repeated losses extend the frenzy but never past the cap on remaining time", async () => {
    const cookie = await userWithPhds(1_000_000);
    let maxRemaining = 0;
    let balance = 1_000_000;
    // Stake half the balance each time: ~30s of frenzy per loss, so a few
    // losses would blow past 120s if the cap weren't enforced.
    for (let i = 0; i < 10; i++) {
      const stake = Math.floor(balance / 2);
      const res = await spin(cookie, { stake, multiplier: 100 });
      expect(res.status).toBe(200);
      balance = res.body.phdCount;
      if (!res.body.won) {
        expect(res.body.consolation.remainingMs).toBeLessThanOrEqual(
          UPGRADER_CONSOLATION_MAX_REMAINING_MS
        );
        maxRemaining = Math.max(maxRemaining, res.body.consolation.remainingMs);
      }
    }
    // The cap is actually reached (>=4 losses of ~30s), not merely never exceeded.
    expect(maxRemaining).toBeGreaterThan(UPGRADER_CONSOLATION_MAX_REMAINING_MS - 5000);
  });

  // The review finding this guards: with a minimum buff length, staking 1 PhD
  // over and over bought a full buff each time, so a player with many PhDs could
  // keep frenzy (x7 production) up almost for free.
  it("regression: a tiny stake earns no frenzy at all — there is no minimum to farm", async () => {
    const cookie = await userWithPhds(1_000_000);
    let res = await spin(cookie, { stake: 10, multiplier: 100 });
    for (let i = 0; i < 5 && res.body.won; i++) {
      res = await spin(cookie, { stake: 10, multiplier: 100 });
    }
    expect(res.body.won).toBe(false);
    expect(res.body.consolation).toBeUndefined();
    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.activeBoosters).toEqual([]);
  });
});

describe("Upgrader endpoint - concurrent spins (race condition)", () => {
  // The anti-cheat property under real conditions: concurrent spins must never
  // spend PhDs the player no longer has. A read-check-write would let several
  // of them pass the balance check against the same stale read; the real
  // implementation closes this with an atomic conditional UPDATE whose row
  // lock serializes them (see database/models/upgrader.ts).
  //
  // x1.2 (a 75% chance) on purpose: a LOSING spin also writes a booster row,
  // which deadlocks racing transactions into withWriteConflictRetry's clean
  // re-run and so would mask a missing guard — the win path has no such
  // second write, so a race there is only prevented by the guard itself.
  // Without it, this test fails in the large majority of runs.
  // Repeated over fresh accounts: a single race only exposes the bug most of
  // the time, three make it a near-certainty.
  it.each([1, 2, 3])(
    "never lets a spin stake PhDs the player no longer has (round %i)",
    async () => {
      const stake = 100;
      const cookie = await userWithPhds(stake);
      const results = await Promise.all(
        Array.from({ length: 12 }, () => spin(cookie, { stake, multiplier: 1.2 }))
      );

      for (const r of results) expect([200, 409]).toContain(r.status);
      // A racer that loses is told the TRUE reason and the real balance — not an
      // overflow error, which a stale in-transaction re-read used to produce.
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.error).toBe(Responses.UPGRADER.INSUFFICIENT_PHD.body.error);
        expect(r.body.phdCount).toBeLessThan(stake);
      }
      const ok = results
        .filter((r) => r.status === 200)
        .sort((a, b) => a.body.upgraderSeq - b.body.upgraderSeq);
      expect(ok.length).toBeGreaterThanOrEqual(1);

      // Replaying the successful spins in sequence order must reproduce every
      // reported balance exactly, and every one of them must have been fully
      // covered by the balance just before it.
      let balance = stake;
      ok.forEach((r, i) => {
        expect(r.body.upgraderSeq).toBe(i + 1);
        expect(balance).toBeGreaterThanOrEqual(stake);
        balance += r.body.won ? r.body.payout - stake : -stake;
        expect(r.body.phdCount).toBe(balance);
      });

      const save = await api.get("/save").set("Cookie", cookie);
      expect(save.body.save.phdCount).toBe(balance);
      expect(balance).toBeGreaterThanOrEqual(0);
    }
  );
});

describe("Upgrader endpoint - overflow guard", () => {
  // phdCount is a signed 32-bit Int column. The check happens before the roll,
  // so the answer never depends on luck, and no out-of-range value reaches the DB.
  it("refuses a spin whose win could overflow the balance: 409 LIMIT_REACHED, nothing changes", async () => {
    const cookie = await userWithPhds(2_000_000_000);
    // A win would be 2e9 - 1e9 + 2e9 = 3e9 PhDs, above 2^31 - 1.
    const res = await spin(cookie, { stake: 1_000_000_000, multiplier: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe(Responses.UPGRADER.LIMIT_REACHED.body.error);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(2_000_000_000);
    expect(save.body.save.upgraderSeq).toBe(0);
  });

  it("still allows a spin at the same balance whose win fits", async () => {
    const cookie = await userWithPhds(2_000_000_000);
    const res = await spin(cookie, { stake: 1000, multiplier: 2 });
    expect(res.status).toBe(200);
  });
});

describe("Upgrader endpoint - concurrent losers are told the truth", () => {
  it("every refused racer gets INSUFFICIENT_PHD with the real balance (never a stale or wrong error)", async () => {
    const cookie = await userWithPhds(100);
    // x100 loses ~99% of the time, so nearly every run has one winner of the
    // PhDs and five racers that must be refused.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => spin(cookie, { stake: 100, multiplier: 100 }))
    );
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(r.body.error).toBe(Responses.UPGRADER.INSUFFICIENT_PHD.body.error);
      expect(typeof r.body.phdCount).toBe("number");
      expect(r.body.phdCount).toBeLessThan(100);
    }
  });
});

describe("Upgrader endpoint - save integration (spin counter / stale-write guard)", () => {
  const saveBody = (over: Record<string, unknown> = {}) => ({
    ...TestData.VALID_SAVE,
    phdCount: 100,
    prestigeCount: 5,
    ...over
  });

  it("GET /save exposes upgraderSeq: 0 for a fresh save, then the spin count", async () => {
    const cookie = await userWithPhds(100);
    let save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.upgraderSeq).toBe(0);

    await spin(cookie, { stake: 10, multiplier: 2 });
    save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.upgraderSeq).toBe(1);
  });

  it("accepts a save that echoes the current counter, and leaves the counter alone", async () => {
    const cookie = await userWithPhds(100);
    const res = await spin(cookie, { stake: 10, multiplier: 2 });

    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(saveBody({ phdCount: res.body.phdCount, upgraderSeq: res.body.upgraderSeq }));
    expect(put.status).toBe(200);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(res.body.phdCount);
    // PUT /save never writes the counter — only a spin does.
    expect(save.body.save.upgraderSeq).toBe(res.body.upgraderSeq);
  });

  // The anti-cheat/correctness property: a save that was made before a later
  // wheel spin must not be able to overwrite that spin's result — in
  // particular it must not hand back PhDs a loss took away. Whatever the
  // roll was, the balance is no longer 100, so the stale save's 100 would be
  // visible if it got through.
  it("regression: a save made before a spin is refused with 409 STALE and changes nothing", async () => {
    const cookie = await userWithPhds(100);
    const res = await spin(cookie, { stake: 10, multiplier: 2 });
    expect(res.body.phdCount).not.toBe(100);

    const stale = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(saveBody({ tokens: 999, upgraderSeq: 0 }));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe(Responses.SAVE.STALE.body.error);
    // Machine-readable, so the client tells it from the envelope's own 409
    // without matching English text.
    expect(stale.body.code).toBe(Responses.SAVE.STALE.body.code);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(res.body.phdCount);
    expect(save.body.save.tokens).toBe(TestData.VALID_SAVE.tokens);
    expect(save.body.save.upgraderSeq).toBe(1);
  });

  it("treats an absent upgraderSeq as 0 — so a client that predates the upgrader is refused after a spin", async () => {
    const cookie = await userWithPhds(100);
    await spin(cookie, { stake: 10, multiplier: 2 });
    const put = await api.put("/save").set("Cookie", cookie).send(saveBody());
    expect(put.status).toBe(409);
    expect(put.body.error).toBe(Responses.SAVE.STALE.body.error);
  });

  it("an absent upgraderSeq is fine for an account that has never spun", async () => {
    const cookie = await userWithPhds(100);
    const put = await api.put("/save").set("Cookie", cookie).send(saveBody());
    expect(put.status).toBe(200);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["a numeric string", "1"],
    ["null", null],
    ["above the INT32 limit", 2_147_483_648]
  ])("rejects an upgraderSeq that is %s with 400", async (_label, upgraderSeq) => {
    const cookie = await userWithPhds(100);
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(saveBody({ upgraderSeq }));
    expect(put.status).toBe(400);
    expect(put.body.error).toBe(Responses.SAVE.INVALID_UPGRADER_SEQ.body.error);
  });
});
