import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import request from "supertest";
import type { ChildProcess } from "child_process";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { PHD_TOKEN_SCALE } from "../constants/gameBalance.js";
import { CAREER_NODES_BY_ID } from "../services/careerCore.js";
import { startTestServer, stopTestServer } from "./testServerHelper.js";

// Spawns its OWN servers, one per mode (see upgraderSave.test.ts for why): the
// Academic Career's save integration is only observable under a specific
// ANTICHEAT_MODE —
//
//  - enforce: that a save right after a purchase is accepted (no clamp, no
//    strike), that a save from BEFORE a purchase is turned away as stale
//    rather than read as forged PhDs, that spent PhDs can't be restored
//    through a save, and that the server really folds the account's stored
//    nodes into the envelope;
//  - off: where the controller skips its stale check entirely, so only
//    upsertSave's locked conditional write keeps a racing save from
//    overwriting a purchase or refund.
//
// Sessions live in the shared database, so a cookie from one server works on
// every other — the ambient monitor server (TestData.BASE_URL, which never
// clamps) is used to SEED states an enforce server would never let a fresh
// account reach.
const ENFORCE_PORT = 2717;
const OFF_PORT = 2718;

const monitor = request(TestData.BASE_URL);

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

const cost = (id: string) => CAREER_NODES_BY_ID.get(id)!.cost;

// A first save a brand-new account can legitimately make under enforce
// (mirrors upgraderSave.test.ts's ENFORCE_SAVE): 1 PhD from 2 prestiges. Its
// prestigeCount opens the purchase window, and the root node costs exactly 1.
const ENFORCE_SAVE = {
  tokens: 2,
  totalTokensEarned: 2,
  totalClicks: 1,
  elapsedSeconds: 1,
  units: [] as never[],
  phdCount: 1,
  prestigeCount: 2
};

describe("Academic Career save integration — ANTICHEAT_MODE=enforce", () => {
  let server: ChildProcess;
  const { api, registerAndLogin } = client(ENFORCE_PORT);

  beforeAll(async () => {
    server = await startTestServer(ENFORCE_PORT, "enforce");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  const strikes = async (cookie: string) =>
    (await api.get("/anticheat/status").set("Cookie", cookie)).body.strikeCount as number;

  async function boughtRoot() {
    const cookie = await registerAndLogin();
    const seed = await api.put("/save").set("Cookie", cookie).send(ENFORCE_SAVE);
    expect(seed.status).toBe(200);
    expect(seed.body.career.windowOpen).toBe(true);
    const res = await api
      .post("/career/buy")
      .set("Cookie", cookie)
      .send({ nodeId: "habilitation" });
    expect(res.status).toBe(200);
    expect(res.body.phdCount).toBe(0);
    return { cookie, seq: res.body.upgraderSeq as number };
  }

  it("regression: the save right after a purchase (lower PhDs, new seq) is accepted, no strike", async () => {
    const { cookie, seq } = await boughtRoot();
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, phdCount: 0, upgraderSeq: seq });
    expect(put.status).toBe(200);
    expect((await api.get("/save").set("Cookie", cookie)).body.save.phdCount).toBe(0);
    expect(await strikes(cookie)).toBe(0);
  });

  it("regression: a save made BEFORE the purchase is refused as stale, not as forged PhDs", async () => {
    const { cookie } = await boughtRoot();
    // Still carries the pre-purchase PhD and the pre-purchase seq (0). Were
    // the envelope to see it first, 1 PhD against an invested-adjusted bound
    // of ~0 would be a reject and a strike on an honest player.
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, upgraderSeq: 0 });
    expect(put.status).toBe(409);
    expect(put.body.code).toBe(Responses.SAVE.STALE.body.code);
    expect(await strikes(cookie)).toBe(0);
  });

  it("a save that restores the spent PhD with the current seq is rejected", async () => {
    const { cookie, seq } = await boughtRoot();
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, phdCount: 1, upgraderSeq: seq });
    expect(put.status).toBe(409);
    expect(put.body.error).toBe(Responses.SAVE.IMPLAUSIBLE.body.error);
    expect((await api.get("/save").set("Cookie", cookie)).body.save.phdCount).toBe(0);

    // ...which restricts the account: buying and refunding are refused, but
    // closing the window (it grants nothing) still works.
    expect(
      (await api.post("/career/refund").set("Cookie", cookie).send({ nodeId: "habilitation" }))
        .status
    ).toBe(403);
    expect(
      (await api.post("/career/buy").set("Cookie", cookie).send({ nodeId: "research.labAccess" }))
        .status
    ).toBe(403);
    const closed = await api.post("/career/close").set("Cookie", cookie).send({});
    expect(closed.status).toBe(200);
    expect(closed.body.career.windowOpen).toBe(false);
  });

  it("an envelope-rejected prestige save opens no window", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, prestigeCount: 0, phdCount: 0 });
    const forged = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...ENFORCE_SAVE, totalTokensEarned: 1e15, tokens: 0, prestigeCount: 5, phdCount: 0 });
    expect(forged.status).toBe(409);
    const save = (await api.get("/save").set("Cookie", cookie)).body.save;
    expect(save.career.windowOpen).toBe(false);
    expect(save.prestigeCount).toBe(0);
  });

  it("the envelope reads the account's stored nodes: a PhD-gain node lets the extra PhDs through", async () => {
    // 20 prestiges over 20 x SCALE tokens: prestige alone explains
    // sqrt(20 x 20) + 1 = 21 PhDs. Seeded on the (never-clamping) monitor
    // server with 23 PhDs, then 1 + 4 of them invested — 18 held.
    const base = {
      tokens: 0,
      totalTokensEarned: 20 * PHD_TOKEN_SCALE,
      totalClicks: 30_000,
      elapsedSeconds: 50_000,
      units: [] as never[],
      prestigeCount: 20
    };
    async function seeded(secondNode: string) {
      const cookie = await registerAndLogin();
      const seed = await monitor
        .put("/save")
        .set("Cookie", cookie)
        .send({ ...base, phdCount: 23 });
      expect(seed.status).toBe(200);
      await monitor.post("/career/buy").set("Cookie", cookie).send({ nodeId: "habilitation" });
      const res = await monitor
        .post("/career/buy")
        .set("Cookie", cookie)
        .send({ nodeId: secondNode });
      expect(res.status).toBe(200);
      expect(res.body.phdCount).toBe(23 - cost("habilitation") - cost(secondNode));
      return { cookie, held: res.body.phdCount as number, seq: res.body.upgraderSeq as number };
    }

    // With +10% PhD gain: 1.1 x 20 + 1 - 5 invested = 18 — exactly what's held.
    const bonus = await seeded("thesis.doctoralSchool");
    const ok = await api
      .put("/save")
      .set("Cookie", bonus.cookie)
      .send({ ...base, phdCount: bonus.held, upgraderSeq: bonus.seq });
    expect(ok.status).toBe(200);
    expect((await api.get("/save").set("Cookie", bonus.cookie)).body.save.phdCount).toBe(18);

    // The same balance after a node WITHOUT a PhD-gain bonus: 21 - 5 = 16, so 18 is clamped.
    const plain = await seeded("research.labAccess");
    const clamped = await api
      .put("/save")
      .set("Cookie", plain.cookie)
      .send({ ...base, phdCount: plain.held, upgraderSeq: plain.seq });
    expect(clamped.status).toBe(200);
    expect((await api.get("/save").set("Cookie", plain.cookie)).body.save.phdCount).toBe(16);
  });
});

describe("Academic Career save integration — ANTICHEAT_MODE=off", () => {
  let server: ChildProcess;
  const { api, registerAndLogin } = client(OFF_PORT);

  beforeAll(async () => {
    server = await startTestServer(OFF_PORT, "off");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  async function withWindow(phdCount: number) {
    const cookie = await registerAndLogin();
    const seed = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount, prestigeCount: 1 });
    expect(seed.body.career.windowOpen).toBe(true);
    return cookie;
  }

  it("a stale save after a purchase is still refused (upsertSave's own guard)", async () => {
    const cookie = await withWindow(50);
    await api.post("/career/buy").set("Cookie", cookie).send({ nodeId: "habilitation" });
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 50, prestigeCount: 1, upgraderSeq: 0 });
    expect(put.status).toBe(409);
    expect(put.body.code).toBe(Responses.SAVE.STALE.body.code);
    expect((await api.get("/save").set("Cookie", cookie)).body.save.phdCount).toBe(49);
  });

  it("a save racing a purchase never overwrites the purchase's PhD debit", async () => {
    for (let round = 0; round < 5; round++) {
      const cookie = await withWindow(50);
      await Promise.all([
        api
          .put("/save")
          .set("Cookie", cookie)
          .send({ ...TestData.VALID_SAVE, phdCount: 50, prestigeCount: 1, upgraderSeq: 0 }),
        api.post("/career/buy").set("Cookie", cookie).send({ nodeId: "habilitation" })
      ]);
      const save = (await api.get("/save").set("Cookie", cookie)).body.save;
      expect(save.phdCount + save.career.phdInvested).toBe(50);
    }
  });

  it("a save racing a refund never overwrites the refund's PhD credit", async () => {
    for (let round = 0; round < 5; round++) {
      const cookie = await withWindow(50);
      const bought = await api
        .post("/career/buy")
        .set("Cookie", cookie)
        .send({ nodeId: "habilitation" });
      await Promise.all([
        api
          .put("/save")
          .set("Cookie", cookie)
          .send({
            ...TestData.VALID_SAVE,
            phdCount: 49,
            prestigeCount: 1,
            upgraderSeq: bought.body.upgraderSeq
          }),
        api.post("/career/refund").set("Cookie", cookie).send({ nodeId: "habilitation" })
      ]);
      const save = (await api.get("/save").set("Cookie", cookie)).body.save;
      expect(save.phdCount + save.career.phdInvested).toBe(50);
    }
  });
});
