import { describe, it, beforeAll, expect } from "@jest/globals";
import request from "supertest";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { CAREER_NODES_BY_ID } from "../services/careerCore.js";

const api = request(TestData.BASE_URL);

const cost = (id: string) => CAREER_NODES_BY_ID.get(id)!.cost;
const ROOT = "habilitation";
const K1 = "research.labAccess";
const T1 = "research.grantWriting.1";
const T2 = "research.grantWriting.2";

async function registerAndLogin(): Promise<string> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// The shared server runs in "monitor" (see testServerHelper.ts): it logs but
// never clamps, so a test can seed any PhD balance. A first-ever save that
// carries a prestige opens the purchase window (windowId 1).
async function userWithWindow(phdCount: number, prestigeCount = 1) {
  const cookie = await registerAndLogin();
  const res = await api
    .put("/save")
    .set("Cookie", cookie)
    .send({ ...TestData.VALID_SAVE, phdCount, prestigeCount });
  expect(res.status).toBe(200);
  return { cookie, put: res };
}

const buy = (cookie: string, nodeId: unknown) =>
  api.post("/career/buy").set("Cookie", cookie).send({ nodeId });
const refund = (cookie: string, nodeId: unknown) =>
  api.post("/career/refund").set("Cookie", cookie).send({ nodeId });
const close = (cookie: string, body: object = {}) =>
  api.post("/career/close").set("Cookie", cookie).send(body);
const load = async (cookie: string) => (await api.get("/save").set("Cookie", cookie)).body.save;

// Buys a chain in order, failing loudly if any step is refused.
async function buyAll(cookie: string, ids: string[]) {
  let last;
  for (const id of ids) {
    last = await buy(cookie, id);
    expect(last.status).toBe(200);
  }
  return last!;
}

// The invariants every mutation must keep: invested == sum of node costs, and
// the leaderboard total == held + invested (read back through the API).
async function expectConsistent(cookie: string) {
  const save = await load(cookie);
  const sum = save.career.nodes.reduce((s: number, n: { cost: number }) => s + n.cost, 0);
  expect(save.career.phdInvested).toBe(sum);
  const lb = await api.get("/leaderboard?metric=phd&limit=1").set("Cookie", cookie);
  expect(lb.body.viewer.value).toBe(save.phdCount + save.career.phdInvested);
  return save;
}

describe("Career endpoints - auth, validation, no save", () => {
  it.each(["buy", "refund", "close"])(
    "POST /career/%s returns 401 without a session",
    async (ep) => {
      const res = await api.post(`/career/${ep}`).send({ nodeId: ROOT });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe(Responses.AUTH.UNAUTHORIZED.body.error);
    }
  );

  it("returns 404 for a logged-in user with no save", async () => {
    const cookie = await registerAndLogin();
    for (const res of [await buy(cookie, ROOT), await refund(cookie, ROOT), await close(cookie)]) {
      expect(res.status).toBe(404);
      expect(res.body.error).toBe(Responses.CAREER.NO_SAVE.body.error);
    }
  });

  describe("with a save", () => {
    let cookie: string;
    beforeAll(async () => {
      ({ cookie } = await userWithWindow(100));
    });

    it.each([
      ["missing", undefined],
      ["a number", 42],
      ["null", null],
      ["unknown", "not.a.node"],
      ["__proto__", "__proto__"],
      ["toString", "toString"],
      ["constructor", "constructor"],
      ["an object", { id: ROOT }]
    ])("rejects a nodeId that is %s with 400 INVALID_NODE", async (_label, nodeId) => {
      for (const res of [await buy(cookie, nodeId), await refund(cookie, nodeId)]) {
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(Responses.CAREER.INVALID_NODE.body.error);
      }
    });

    it("rejects an absent or non-object body", async () => {
      const res = await api.post("/career/buy").set("Cookie", cookie);
      expect(res.status).toBe(400);
    });

    it.each([
      ["negative", -1],
      ["fractional", 1.5],
      ["a string", "1"],
      ["null", null],
      ["above INT32", 2_147_483_648]
    ])("rejects a windowId that is %s with 400 INVALID_WINDOW_ID", async (_l, windowId) => {
      const res = await close(cookie, { windowId });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(Responses.CAREER.INVALID_WINDOW_ID.body.error);
    });

    it("changes nothing when validation fails (validate-then-write)", async () => {
      const save = await load(cookie);
      expect(save.phdCount).toBe(100);
      expect(save.career.windowOpen).toBe(true);
      expect(save.career.nodes).toEqual([]);
    });
  });
});

describe("Career window - opened only by a prestige", () => {
  it("GET /save carries empty defaults for an account that never touched the tree", async () => {
    const cookie = await registerAndLogin();
    await api.put("/save").set("Cookie", cookie).send(TestData.VALID_SAVE);
    const save = await load(cookie);
    expect(save.career).toEqual({ windowOpen: false, windowId: 0, phdInvested: 0, nodes: [] });
  });

  it("a first-ever save carrying a prestige opens window 1, and PUT /save says so", async () => {
    const { cookie, put } = await userWithWindow(10);
    expect(put.body.career).toEqual({ windowOpen: true, windowId: 1 });
    expect((await load(cookie)).career.windowOpen).toBe(true);
  });

  it("a first-ever save without a prestige opens nothing", async () => {
    const cookie = await registerAndLogin();
    const put = await api.put("/save").set("Cookie", cookie).send(TestData.VALID_SAVE);
    expect(put.body.career).toEqual({ windowOpen: false, windowId: 0 });
  });

  it("re-saving the same prestigeCount (e.g. a player who prestiged before this shipped) opens nothing", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 5, prestigeCount: 0 });
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 5, prestigeCount: 0 });
    expect((await load(cookie)).career.windowOpen).toBe(false);
  });

  it("an omitted prestigeCount (a legacy client) opens nothing", async () => {
    const { cookie } = await userWithWindow(10);
    await close(cookie);
    const put = await api.put("/save").set("Cookie", cookie).send(TestData.VALID_SAVE);
    expect(put.status).toBe(200);
    expect(put.body.career.windowOpen).toBe(false);
  });

  it("a new prestige opens a new window, making the previous window's purchases permanent", async () => {
    const { cookie } = await userWithWindow(100);
    const bought = await buy(cookie, ROOT);
    // A second prestige while window 1 is still open.
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({
        ...TestData.VALID_SAVE,
        phdCount: bought.body.phdCount + 20,
        prestigeCount: 2,
        upgraderSeq: bought.body.upgraderSeq
      });
    expect(put.body.career).toEqual({ windowOpen: true, windowId: 2 });
    const save = await load(cookie);
    expect(save.career.nodes).toEqual([{ nodeId: ROOT, cost: cost(ROOT), refundable: false }]);
    const res = await refund(cookie, ROOT);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.NOT_REFUNDABLE.body.code);
  });

  it("a stale save (made before a purchase) is refused and does not open a window", async () => {
    const { cookie } = await userWithWindow(100);
    await close(cookie);
    const staleSeq = (await load(cookie)).upgraderSeq;
    // Open a window properly, buy (bumping the seq), close it again.
    const opened = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 120, prestigeCount: 2, upgraderSeq: staleSeq });
    expect(opened.body.career.windowId).toBe(2);
    await buy(cookie, ROOT);
    await close(cookie);
    const stale = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 150, prestigeCount: 3, upgraderSeq: staleSeq });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe(Responses.SAVE.STALE.body.code);
    const save = await load(cookie);
    expect(save.career.windowOpen).toBe(false);
    expect(save.career.windowId).toBe(2);
    expect(save.prestigeCount).toBe(2);
  });
});

describe("Career window - never open into a run that has started", () => {
  const resave = (cookie: string, seq: number, run: Record<string, number>) =>
    api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 99, prestigeCount: 1, upgraderSeq: seq, ...run });

  it("a save with run clicks closes the window and makes its purchases permanent", async () => {
    const { cookie } = await userWithWindow(100);
    const bought = await buy(cookie, ROOT);
    const put = await resave(cookie, bought.body.upgraderSeq, { runClicks: 3, runSeconds: 2 });
    expect(put.body.career.windowOpen).toBe(false);
    const res = await refund(cookie, ROOT);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.WINDOW_CLOSED.body.code);
  });

  it("a save with run time past the grace closes it too", async () => {
    const { cookie } = await userWithWindow(100);
    const bought = await buy(cookie, ROOT);
    const put = await resave(cookie, bought.body.upgraderSeq, { runClicks: 0, runSeconds: 600 });
    expect(put.body.career.windowOpen).toBe(false);
  });

  it("a save from the paused game (no run clicks, no run time) keeps it open", async () => {
    const { cookie } = await userWithWindow(100);
    const bought = await buy(cookie, ROOT);
    const put = await resave(cookie, bought.body.upgraderSeq, { runClicks: 0, runSeconds: 0 });
    expect(put.body.career.windowOpen).toBe(true);
    expect((await refund(cookie, ROOT)).status).toBe(200);
  });

  it("a save that omits the run fields (a legacy client) leaves the window alone", async () => {
    const { cookie } = await userWithWindow(100);
    const bought = await buy(cookie, ROOT);
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, upgraderSeq: bought.body.upgraderSeq });
    expect(put.body.career.windowOpen).toBe(true);
  });

  it("a prestigeCount bump that gained no PhD opens no window", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 5, prestigeCount: 0 });
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 5, prestigeCount: 1 });
    expect(put.body.career.windowOpen).toBe(false);
    // ...nor does a first-ever save claiming a prestige with no PhDs.
    const other = await registerAndLogin();
    const first = await api
      .put("/save")
      .set("Cookie", other)
      .send({ ...TestData.VALID_SAVE, phdCount: 0, prestigeCount: 3 });
    expect(first.body.career.windowOpen).toBe(false);
  });
});

describe("Career buy", () => {
  it("debits the price, records the node, bumps upgraderSeq and keeps totals consistent", async () => {
    const { cookie } = await userWithWindow(100);
    const res = await buy(cookie, ROOT);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.CAREER.BUY_SUCCESS.body.message);
    expect(res.body.phdCount).toBe(100 - cost(ROOT));
    expect(res.body.upgraderSeq).toBe(1);
    expect(res.body.career.nodes).toEqual([{ nodeId: ROOT, cost: cost(ROOT), refundable: true }]);
    expect(res.body.career.phdInvested).toBe(cost(ROOT));
    const save = await expectConsistent(cookie);
    expect(save.phdCount).toBe(100 - cost(ROOT));
    expect(save.upgraderSeq).toBe(1);
  });

  it("refuses an already-owned node (409 ALREADY_OWNED) and charges nothing", async () => {
    const { cookie } = await userWithWindow(100);
    await buy(cookie, ROOT);
    const res = await buy(cookie, ROOT);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.ALREADY_OWNED.body.code);
    expect(res.body.phdCount).toBe(100 - cost(ROOT));
  });

  it("refuses a node whose parent isn't owned (409 PREREQUISITE_MISSING)", async () => {
    const { cookie } = await userWithWindow(100);
    const res = await buy(cookie, K1);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.PREREQUISITE_MISSING.body.code);
    expect((await load(cookie)).phdCount).toBe(100);
  });

  it("refuses an unaffordable node with the real balance (409 INSUFFICIENT_PHD)", async () => {
    // Exactly enough for the root, then nothing left for the next node.
    const { cookie } = await userWithWindow(cost(ROOT));
    await buy(cookie, ROOT);
    const res = await buy(cookie, K1);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.INSUFFICIENT_PHD.body.code);
    expect(res.body.phdCount).toBe(0);
    expect((await load(cookie)).career.nodes).toHaveLength(1);
  });

  it("refuses everything once the window is closed (409 WINDOW_CLOSED)", async () => {
    const { cookie } = await userWithWindow(100);
    await close(cookie);
    const res = await buy(cookie, ROOT);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.WINDOW_CLOSED.body.code);
    expect(res.body.career.windowOpen).toBe(false);
  });

  it("refuses an account that has never prestiged (no window was ever opened)", async () => {
    const cookie = await registerAndLogin();
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 50 });
    const res = await buy(cookie, ROOT);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.WINDOW_CLOSED.body.code);
  });

  it("buying never moves the PhD leaderboard total", async () => {
    const { cookie } = await userWithWindow(100);
    const before = (await api.get("/leaderboard?metric=phd&limit=1").set("Cookie", cookie)).body
      .viewer.value;
    await buyAll(cookie, [ROOT, K1, T1]);
    const after = (await api.get("/leaderboard?metric=phd&limit=1").set("Cookie", cookie)).body
      .viewer.value;
    expect(before).toBe(100);
    expect(after).toBe(100);
    await expectConsistent(cookie);
  });
});

describe("Career refund", () => {
  it("cascades to every in-window descendant at the price paid", async () => {
    const { cookie } = await userWithWindow(100);
    await buyAll(cookie, [ROOT, K1, T1, T2]);
    const res = await refund(cookie, K1);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.CAREER.REFUND_SUCCESS.body.message);
    expect(res.body.refundedNodeIds).toEqual([K1, T1, T2]);
    expect(res.body.phdRefunded).toBe(cost(K1) + cost(T1) + cost(T2));
    expect(res.body.phdCount).toBe(100 - cost(ROOT));
    expect(res.body.career.nodes.map((n: { nodeId: string }) => n.nodeId)).toEqual([ROOT]);
    expect(res.body.upgraderSeq).toBe(5); // 4 buys + 1 refund
    await expectConsistent(cookie);
  });

  it("refuses a node that isn't owned (409 NOT_OWNED)", async () => {
    const { cookie } = await userWithWindow(100);
    const res = await refund(cookie, ROOT);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.NOT_OWNED.body.code);
  });

  it("refuses once the window is closed — purchases are then permanent", async () => {
    const { cookie } = await userWithWindow(100);
    await buy(cookie, ROOT);
    await close(cookie);
    const res = await refund(cookie, ROOT);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(Responses.CAREER.WINDOW_CLOSED.body.code);
    expect((await load(cookie)).career.nodes).toEqual([
      { nodeId: ROOT, cost: cost(ROOT), refundable: false }
    ]);
  });
});

describe("Career close", () => {
  it("is idempotent", async () => {
    const { cookie } = await userWithWindow(10);
    for (let i = 0; i < 2; i++) {
      const res = await close(cookie);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(Responses.CAREER.CLOSE_SUCCESS.body.message);
      expect(res.body.career.windowOpen).toBe(false);
    }
  });

  it("with a matching windowId closes; with a mismatched one refuses and stays open", async () => {
    const { cookie } = await userWithWindow(10);
    const wrong = await close(cookie, { windowId: 7 });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe(Responses.CAREER.WINDOW_CHANGED.body.code);
    expect(wrong.body.career.windowOpen).toBe(true);
    const right = await close(cookie, { windowId: 1 });
    expect(right.status).toBe(200);
    expect(right.body.career.windowOpen).toBe(false);
  });

  it("does not bump upgraderSeq (it changes no PhDs)", async () => {
    const { cookie } = await userWithWindow(10);
    const res = await close(cookie);
    expect(res.body.upgraderSeq).toBe(0);
  });
});

describe("Career and the rest of the save", () => {
  it("DELETE /save removes every node with the save", async () => {
    const { cookie } = await userWithWindow(100);
    await buyAll(cookie, [ROOT, K1]);
    await api.delete("/save").set("Cookie", cookie);
    expect(await load(cookie)).toBeNull();
    // The same account starting over has an empty tree.
    await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 5, prestigeCount: 1 });
    expect((await load(cookie)).career.nodes).toEqual([]);
  });

  it("a wheel spin moves the leaderboard total by exactly its delta", async () => {
    const { cookie } = await userWithWindow(100);
    await buyAll(cookie, [ROOT, K1]);
    const spin = await api
      .post("/upgrader/spin")
      .set("Cookie", cookie)
      .send({ stake: 10, multiplier: 2 });
    expect(spin.status).toBe(200);
    const save = await expectConsistent(cookie);
    expect(save.phdCount + save.career.phdInvested).toBe(100 + (spin.body.won ? 10 : -10));
  });
});

describe("Career and PUT /save limits", () => {
  it("regression: PhD balances past the old INT range are stored exactly", async () => {
    const big = 3_000_000_000_017; // far past 2147483647, still an exact whole number
    const { cookie } = await userWithWindow(big);
    expect((await load(cookie)).phdCount).toBe(big);
    const bought = await buy(cookie, ROOT);
    expect(bought.body.phdCount).toBe(big - cost(ROOT));
    const lb = await api.get("/leaderboard?metric=phd&limit=1").set("Cookie", cookie);
    expect(lb.body.viewer.value).toBe(big);
  });

  it("still refuses a fractional phdCount", async () => {
    const cookie = await registerAndLogin();
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.VALID_SAVE, phdCount: 10.5 });
    expect(put.status).toBe(400);
    expect(put.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("refuses (400 PHD_LIMIT) a phdCount that, with the invested PhDs, passes 2^53 - 1", async () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    const { cookie } = await userWithWindow(MAX);
    const bought = await buy(cookie, ROOT);
    expect(bought.status).toBe(200);
    const put = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({
        ...TestData.VALID_SAVE,
        phdCount: MAX,
        prestigeCount: 1,
        upgraderSeq: bought.body.upgraderSeq
      });
    expect(put.status).toBe(400);
    expect(put.body.error).toBe(Responses.SAVE.PHD_LIMIT.body.error);
    expect((await load(cookie)).phdCount).toBe(MAX - cost(ROOT));
  });

  it("parallel first-ever saves (two tabs) all land on one row, none 500s", async () => {
    const cookie = await registerAndLogin();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api
          .put("/save")
          .set("Cookie", cookie)
          .send({ ...TestData.VALID_SAVE, phdCount: 3, prestigeCount: 1 })
      )
    );
    for (const r of results) expect(r.status).toBe(200);
    const save = await load(cookie);
    expect(save.career.windowId).toBe(1);
    expect(save.career.windowOpen).toBe(true);
  });
});

describe("Career concurrency", () => {
  it("parallel buys of one node: exactly one succeeds, debited once", async () => {
    const { cookie } = await userWithWindow(100);
    const results = await Promise.all(Array.from({ length: 12 }, () => buy(cookie, ROOT)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 200)) {
      expect(r.status).toBe(409);
      expect(r.body.code).toBe(Responses.CAREER.ALREADY_OWNED.body.code);
    }
    const save = await expectConsistent(cookie);
    expect(save.phdCount).toBe(100 - cost(ROOT));
    expect(save.upgraderSeq).toBe(1);
  });

  it("parallel buys that together exceed the balance never overdraw it", async () => {
    // Root + the six first-ring keystones cost more than this balance.
    const ring = [
      "research.labAccess",
      "lecturing.lecturer",
      "administration.departmentBudget",
      "conferences.conferenceSeason",
      "thesis.doctoralSchool",
      "lab.teachingAssistant"
    ];
    const balance = cost(ROOT) + cost(ring[0]!) * 3;
    const { cookie } = await userWithWindow(balance);
    await buy(cookie, ROOT);
    await Promise.all(ring.map((id) => buy(cookie, id)));
    const save = await expectConsistent(cookie);
    expect(save.phdCount).toBeGreaterThanOrEqual(0);
    expect(save.phdCount + save.career.phdInvested).toBe(balance);
    expect(save.career.nodes).toHaveLength(4);
  });

  it("parallel refunds of one node: one succeeds, credited once", async () => {
    const { cookie } = await userWithWindow(100);
    await buyAll(cookie, [ROOT, K1]);
    const results = await Promise.all(Array.from({ length: 8 }, () => refund(cookie, K1)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((r) => r.status !== 200)) {
      expect(r.body.code).toBe(Responses.CAREER.NOT_OWNED.body.code);
    }
    const save = await expectConsistent(cookie);
    expect(save.phdCount).toBe(100 - cost(ROOT));
  });

  it("a child buy racing its parent's refund always leaves a prerequisite-closed tree", async () => {
    for (let round = 0; round < 5; round++) {
      const { cookie } = await userWithWindow(100);
      await buyAll(cookie, [ROOT, K1]);
      await Promise.all([buy(cookie, T1), refund(cookie, K1)]);
      const save = await expectConsistent(cookie);
      const owned = new Set(save.career.nodes.map((n: { nodeId: string }) => n.nodeId));
      for (const id of owned) {
        const parent = CAREER_NODES_BY_ID.get(id as string)!.parent;
        if (parent !== null) expect(owned.has(parent)).toBe(true);
      }
      expect(save.phdCount + save.career.phdInvested).toBe(100);
    }
  });

  it("a prestige save racing a close leaves a consistent window", async () => {
    for (let round = 0; round < 5; round++) {
      const { cookie } = await userWithWindow(10);
      const [put] = await Promise.all([
        api
          .put("/save")
          .set("Cookie", cookie)
          .send({ ...TestData.VALID_SAVE, phdCount: 20, prestigeCount: 2 }),
        close(cookie, { windowId: 1 })
      ]);
      expect(put.status).toBe(200);
      const save = await load(cookie);
      // Either the close won (window 1 closed, then 2 opened) or the save won
      // (window 2 open; the close for window 1 was refused) — 2 is open either way.
      expect(save.career.windowId).toBe(2);
      expect(save.career.windowOpen).toBe(true);
    }
  });
});
