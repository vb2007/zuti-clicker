import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import request from "supertest";
import type { ChildProcess } from "child_process";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { startTestServer, stopTestServer } from "./testServerHelper.js";

// Spawns its OWN servers (own ports, one per mode) — see
// envelopeEnforcement.test.ts for why: the ambient server every other file
// shares runs in "monitor", but two properties of the upgrader's save
// integration are only observable under a specific mode:
//
//  - enforce: that a win is not clamped by the PhD bound, and that a STALE
//    save is turned away BEFORE the envelope can mistake it for forged PhDs
//    and strike an honest player;
//  - off: where the controller skips its early stale check entirely, so a
//    stale save can only be stopped by upsertSave's own conditional write —
//    the guard that also closes the race with a spin committing in between.
const ENFORCE_PORT = 2715;
const OFF_PORT = 2716;

function client(port: number) {
  const api = request(`http://localhost:${port}`);
  async function registerAndLogin(): Promise<string> {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
    return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  }
  return { api, registerAndLogin };
}

// The smallest valid bet: 1 PhD at x2 pays 2 (45% chance). A fresh account can
// only legitimately hold 1 PhD under enforce (the PhD bound is
// sqrt(prestige * earned / 1e6) + 1), so this is the bet that exists there.
const STAKE = 1;
const MULTIPLIER = 2;

// Base fields of a save that is plausible for a brand-new account under enforce
// (mirrors envelopeEnforcement.test.ts's "modest, achievable first save").
const ENFORCE_SAVE = {
  tokens: 2,
  totalTokensEarned: 2,
  totalClicks: 1,
  elapsedSeconds: 1,
  units: [] as never[],
  phdCount: 1,
  prestigeCount: 2
};

describe("Upgrader save integration — ANTICHEAT_MODE=enforce", () => {
  let server: ChildProcess;
  const { api, registerAndLogin } = client(ENFORCE_PORT);

  beforeAll(async () => {
    server = await startTestServer(ENFORCE_PORT, "enforce");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  // The server's RNG can't be forced, so a test that needs a specific outcome
  // spins fresh accounts until it gets one (45% per spin: 40 attempts fail
  // with probability < 1e-10).
  async function spinUntil(wantWin: boolean) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const cookie = await registerAndLogin();
      const seed = await api.put("/save").set("Cookie", cookie).send(ENFORCE_SAVE);
      expect(seed.status).toBe(200);
      const res = await api
        .post("/upgrader/spin")
        .set("Cookie", cookie)
        .send({ stake: STAKE, multiplier: MULTIPLIER });
      expect(res.status).toBe(200);
      if (res.body.won === wantWin) return { cookie, res };
    }
    throw new Error(`no ${wantWin ? "winning" : "losing"} spin in 40 attempts`);
  }

  const strikes = async (cookie: string) =>
    (await api.get("/anticheat/status").set("Cookie", cookie)).body.strikeCount as number;

  // Before the upgrader, phdCount could only ever be explained by prestige, so
  // a balance of 2 here (1 earned + 1 won) sat in the CLAMP band of the old
  // bound (1.002) and would have been silently cut back to 1.
  it("regression: PhDs won on the wheel are accepted on the next save, not clamped away", async () => {
    const { cookie, res } = await spinUntil(true);
    expect(res.body.phdCount).toBe(2);

    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, phdCount: res.body.phdCount, upgraderSeq: res.body.upgraderSeq });
    expect(put.status).toBe(200);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(2);
    expect(await strikes(cookie)).toBe(0);
  });

  it("a loss followed by a resync of the new, lower balance is accepted with no strike", async () => {
    const { cookie, res } = await spinUntil(false);
    expect(res.body.phdCount).toBe(0);

    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, phdCount: 0, upgraderSeq: res.body.upgraderSeq });
    expect(put.status).toBe(200);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(0);
    expect(await strikes(cookie)).toBe(0);
  });

  // The false-strike scenario this whole stale guard exists for: after a loss
  // the envelope's PhD bound is ~0, so a save still carrying the pre-spin
  // balance of 1 would look like forged PhDs and strike an honest player — if
  // the envelope ran first. The stale check must come first.
  it("regression: a save made before a losing spin gets 409 STALE — not IMPLAUSIBLE — and no strike", async () => {
    const { cookie } = await spinUntil(false);

    const stale = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, phdCount: 1, upgraderSeq: 0 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe(Responses.SAVE.STALE.body.error);
    expect(stale.body.error).not.toBe(Responses.SAVE.IMPLAUSIBLE.body.error);

    expect(await strikes(cookie)).toBe(0);
    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(0);
  });

  it("a genuinely forged PhD count is still struck (the net does not open a loophole)", async () => {
    const cookie = await registerAndLogin();
    await api.put("/save").set("Cookie", cookie).send(ENFORCE_SAVE);
    const forged = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, phdCount: 1000, upgraderSeq: 0 });
    expect(forged.status).toBe(409);
    expect(forged.body.error).toBe(Responses.SAVE.IMPLAUSIBLE.body.error);
    expect(await strikes(cookie)).toBe(1);
  });

  it("a restricted account cannot spin: 403 RESTRICTED, and nothing is spent", async () => {
    const cookie = await registerAndLogin();
    await api.put("/save").set("Cookie", cookie).send(ENFORCE_SAVE);
    // A monotonicity break is a strike, which restricts the account.
    const strike = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, totalTokensEarned: 1, tokens: 0 });
    expect(strike.status).toBe(409);

    const res = await api
      .post("/upgrader/spin")
      .set("Cookie", cookie)
      .send({ stake: STAKE, multiplier: MULTIPLIER });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(Responses.ANTICHEAT.RESTRICTED.body.error);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(1);
    expect(save.body.save.upgraderSeq).toBe(0);
  });
});

describe("Upgrader save integration — ANTICHEAT_MODE=off (upsertSave's own guard)", () => {
  let server: ChildProcess;
  const { api, registerAndLogin } = client(OFF_PORT);

  beforeAll(async () => {
    server = await startTestServer(OFF_PORT, "off");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  const saveBody = (over: Record<string, unknown> = {}) => ({
    ...TestData.VALID_SAVE,
    phdCount: 100,
    prestigeCount: 5,
    ...over
  });

  async function seeded(): Promise<string> {
    const cookie = await registerAndLogin();
    const res = await api.put("/save").set("Cookie", cookie).send(saveBody());
    expect(res.status).toBe(200);
    return cookie;
  }

  const spin = (cookie: string) =>
    api.post("/upgrader/spin").set("Cookie", cookie).send({ stake: 10, multiplier: 2 });

  // With the plausibility envelope off, the controller's early stale check is
  // skipped, so this 409 can only come from upsertSave's conditional write.
  it("regression: a save made before a spin is still refused when the envelope is off", async () => {
    const cookie = await seeded();
    const res = await spin(cookie);
    expect(res.status).toBe(200);

    const stale = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(saveBody({ tokens: 999, upgraderSeq: 0 }));
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe(Responses.SAVE.STALE.body.error);

    const save = await api.get("/save").set("Cookie", cookie);
    expect(save.body.save.phdCount).toBe(res.body.phdCount);
    expect(save.body.save.tokens).toBe(TestData.VALID_SAVE.tokens);
  });

  // A save and a spin racing each other: whichever commits first, the final
  // balance must be the spin's result — never the stale save's 100 written on
  // top of it. (Repeated: a single round only races about half the time.)
  it.each([1, 2, 3, 4, 5])(
    "regression: a save racing a spin can never overwrite the spin's result (round %i)",
    async () => {
      const cookie = await seeded();
      const [spun, put] = await Promise.all([
        spin(cookie),
        api.put("/save").set("Cookie", cookie).send(saveBody({ upgraderSeq: 0 }))
      ]);
      expect(spun.status).toBe(200);
      expect([200, 409]).toContain(put.status);

      const save = await api.get("/save").set("Cookie", cookie);
      expect(save.body.save.phdCount).toBe(spun.body.phdCount);
      expect(save.body.save.upgraderSeq).toBe(1);
    }
  );
});
