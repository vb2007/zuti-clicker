import { describe, it, beforeAll, afterAll, expect } from "@jest/globals";
import request from "supertest";
import type { ChildProcess } from "child_process";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import {
  CLOCK_GRACE_SECS,
  SAVE_LEAD_CAP_SECS,
  SAVE_LEAD_DECAY_PER_SEC
} from "../constants/antiCheat.js";
import { startTestServer, stopTestServer } from "./testServerHelper.js";
import { prisma } from "../database/prisma.js";

// The grace lead over HTTP (see services/graceLead.ts): on its own enforce
// server, like envelopeEnforcement.test.ts, since the ambient test server
// runs in monitor mode and never refuses anything.
const PORT = 2719;
const api = request(`http://localhost:${PORT}`);

interface Account {
  cookie: string;
  id: number;
}

async function registerAndLogin(): Promise<Account> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
  const { id } = await prisma.user.findUniqueOrThrow({
    where: { email: user.email },
    select: { id: true }
  });
  return { cookie: (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0], id };
}

const strikes = async (cookie: string) =>
  ((await api.get("/anticheat/status").set("Cookie", cookie)).body as { strikeCount: number })
    .strikeCount;
const softClamps = async (userId: number) =>
  (await prisma.antiCheatState.findUnique({ where: { userId } }))?.softClampCount ?? 0;
const stored = async (userId: number) =>
  prisma.gameSave.findUniqueOrThrow({ where: { userId } });

// An idle save: nothing earned, only playtime (and clicks) — the two
// leaderboards save spamming inflated.
const save = (elapsedSeconds: number, totalClicks = 0) => ({
  tokens: 0,
  totalTokensEarned: 0,
  totalClicks,
  elapsedSeconds,
  units: []
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("grace lead — ANTICHEAT_MODE=enforce", () => {
  let server: ChildProcess;

  beforeAll(async () => {
    server = await startTestServer(PORT, "enforce");
  }, 25_000);

  afterAll(async () => {
    await stopTestServer(server);
  });

  // Regression: every save got its own 5 s grace, so saving ten times a
  // second, each claiming the time since the last accepted save plus that
  // grace, was accepted every time — ~51x real playtime.
  it("saving 10x/s, each claiming the full grace, gets refused (429) — never struck", async () => {
    const { cookie, id } = await registerAndLogin();
    expect((await api.put("/save").set("Cookie", cookie).send(save(1, 1))).status).toBe(200);
    const start = Date.now();
    let acceptedAt = Date.now();
    let elapsed = 1;
    let clicks = 1;
    let refused = 0;
    while (Date.now() - start < 3000) {
      await sleep(100);
      const ahead = (Date.now() - acceptedAt) / 1000 + CLOCK_GRACE_SECS - 0.1;
      const res = await api
        .put("/save")
        .set("Cookie", cookie)
        .send(save(elapsed + ahead, clicks + Math.floor(ahead * 40)));
      if (res.status === 200) {
        elapsed += ahead;
        clicks += Math.floor(ahead * 40);
        acceptedAt = Date.now();
        continue;
      }
      expect(res.status).toBe(Responses.SAVE.RATE_LIMITED.status);
      expect(res.body.code).toBe(Responses.SAVE.RATE_LIMITED.body.code);
      expect(res.body.error).toBe(Responses.SAVE.RATE_LIMITED.body.error);
      expect(res.body.retryAfterMs).toBeGreaterThan(0);
      expect(Number(res.headers["retry-after"])).toBe(Math.ceil(res.body.retryAfterMs / 1000));
      refused++;
    }
    const wall = (Date.now() - start) / 1000 + 1;
    const row = await stored(id);
    expect(refused).toBeGreaterThan(10);
    expect(row.elapsedSeconds - 1).toBeLessThanOrEqual(
      wall + SAVE_LEAD_CAP_SECS + SAVE_LEAD_DECAY_PER_SEC * wall
    );
    expect(row.graceLeadSecs).toBeGreaterThan(SAVE_LEAD_CAP_SECS - CLOCK_GRACE_SECS);
    expect(await strikes(cookie)).toBe(0);
    expect(await softClamps(id)).toBe(0);
    const events = await prisma.antiCheatEvent.findMany({
      where: { userId: id, kind: "save_rate_limited" }
    });
    // Logged once, not once per refusal.
    expect(events).toHaveLength(1);
  }, 20_000);

  it("an honest burst — 30 saves back to back at real-time claims — is never refused", async () => {
    const { cookie, id } = await registerAndLogin();
    expect((await api.put("/save").set("Cookie", cookie).send(save(1))).status).toBe(200);
    let elapsed = 1;
    let last = Date.now();
    for (let i = 0; i < 30; i++) {
      // What the client's tick counted since its last save: never more than
      // the time between taking the two snapshots.
      const now = Date.now();
      elapsed += (now - last) / 1000;
      last = now;
      const res = await api.put("/save").set("Cookie", cookie).send(save(elapsed));
      expect(res.status).toBe(200);
    }
    expect((await stored(id)).graceLeadSecs).toBeLessThan(1);
    expect(await strikes(cookie)).toBe(0);
  }, 20_000);

  // Regression: an upload that stalled (here 12 s between the client taking
  // the snapshot and the server writing it) followed right away by the next
  // save — a pre-purchase flush, say — claimed 12 s more than the server's
  // interval: over twice the fixed 5 s grace, rejected and struck.
  it("a save right after a stalled one is accepted, not struck", async () => {
    const { cookie, id } = await registerAndLogin();
    expect((await api.put("/save").set("Cookie", cookie).send(save(100))).status).toBe(200);
    const res = await api.put("/save").set("Cookie", cookie).send(save(112.3));
    expect(res.status).toBe(200);
    const row = await stored(id);
    expect(row.elapsedSeconds).toBe(112.3);
    expect(row.graceLeadSecs).toBeGreaterThan(11);
    expect(await strikes(cookie)).toBe(0);
  });

  describe("a first save after a reset", () => {
    const DAY = 24 * 3600;
    const monthOld = async (account: Account) => {
      await prisma.user.update({
        where: { id: account.id },
        data: { createdAt: new Date(Date.now() - 30 * DAY * 1000) }
      });
    };

    // Regression: the next save after DELETE /save is a first save, and a
    // first save was anchored at the account's creation — a month-old
    // account could wipe its save and claim a month of playtime.
    it("is anchored at the reset, not at the account's creation", async () => {
      const account = await registerAndLogin();
      await monthOld(account);
      expect((await api.put("/save").set("Cookie", account.cookie).send(save(10))).status).toBe(
        200
      );
      expect((await api.delete("/save").set("Cookie", account.cookie)).status).toBe(200);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
      expect(user.saveResetAt).not.toBeNull();

      const res = await api
        .put("/save")
        .set("Cookie", account.cookie)
        .send(save(10 * DAY, 1000));
      expect(res.status).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.status);
      expect(res.body.code).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.body.code);
      expect((await api.get("/save").set("Cookie", account.cookie)).body.save).toBeNull();
      expect(await strikes(account.cookie)).toBe(0);

      // A fresh game after the reset is a first save like any other.
      expect((await api.put("/save").set("Cookie", account.cookie).send(save(3))).status).toBe(
        200
      );
    });

    it("from a player struck before their own reset: refused, never struck", async () => {
      const account = await registerAndLogin();
      await monthOld(account);
      await prisma.antiCheatState.create({
        data: { userId: account.id, strikeCount: 1, lastStrikeAt: new Date(Date.now() - 60_000) }
      });
      expect((await api.delete("/save").set("Cookie", account.cookie)).status).toBe(200);
      // The old progress of a second device that never heard of the reset.
      const res = await api
        .put("/save")
        .set("Cookie", account.cookie)
        .send(save(10 * DAY, 1000));
      expect(res.status).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.status);
      expect(res.body.code).toBe(Responses.SAVE.FIRST_SAVE_UNVERIFIABLE.body.code);
      expect(await strikes(account.cookie)).toBe(1);
    });

    // Regression (live review of 1.7.4): the device the player reset on saved
    // the fresh game first; another device still running the old game then
    // sent that — not a first save any more, rejected, and struck.
    it("a second device's pre-reset progress after the fresh save: refused, never struck", async () => {
      const account = await registerAndLogin();
      await monthOld(account);
      const old = save(10 * DAY, 1000);
      expect((await api.put("/save").set("Cookie", account.cookie).send(old)).status).toBe(200);
      expect((await api.delete("/save").set("Cookie", account.cookie)).status).toBe(200);
      expect((await api.put("/save").set("Cookie", account.cookie).send(save(5))).status).toBe(200);
      const res = await api
        .put("/save")
        .set("Cookie", account.cookie)
        .send({ ...old, elapsedSeconds: old.elapsedSeconds + 60 });
      expect(res.status).toBe(Responses.SAVE.IMPLAUSIBLE.status);
      expect(res.body.code).toBe(Responses.SAVE.IMPLAUSIBLE.body.code);
      expect(await strikes(account.cookie)).toBe(0);
      expect((await stored(account.id)).elapsedSeconds).toBe(5);
      const events = await prisma.antiCheatEvent.findMany({
        where: { userId: account.id, kind: "reset_stale_copy" }
      });
      expect(events).toHaveLength(1);
    });

    it("a reject after a strike that came after the reset still strikes", async () => {
      const account = await registerAndLogin();
      await monthOld(account);
      expect((await api.put("/save").set("Cookie", account.cookie).send(save(10))).status).toBe(
        200
      );
      expect((await api.delete("/save").set("Cookie", account.cookie)).status).toBe(200);
      expect((await api.put("/save").set("Cookie", account.cookie).send(save(5))).status).toBe(200);
      await prisma.antiCheatState.upsert({
        where: { userId: account.id },
        update: { strikeCount: 1, lastStrikeAt: new Date(Date.now() + 1000) },
        create: { userId: account.id, strikeCount: 1, lastStrikeAt: new Date(Date.now() + 1000) }
      });
      const res = await api
        .put("/save")
        .set("Cookie", account.cookie)
        .send(save(10 * DAY, 1000));
      expect(res.status).toBe(Responses.SAVE.IMPLAUSIBLE.status);
      expect(await strikes(account.cookie)).toBe(2);
    });

    it("after the strike ladder's own wipe: a reject still strikes", async () => {
      const account = await registerAndLogin();
      await monthOld(account);
      const wipedAt = new Date(Date.now() - 60_000);
      await prisma.antiCheatState.create({
        data: { userId: account.id, strikeCount: 5, lastStrikeAt: wipedAt }
      });
      await prisma.user.update({ where: { id: account.id }, data: { saveResetAt: wipedAt } });
      const res = await api
        .put("/save")
        .set("Cookie", account.cookie)
        .send(save(10 * DAY, 1000));
      expect(res.status).toBe(Responses.SAVE.IMPLAUSIBLE.status);
      expect(res.body.code).toBe(Responses.SAVE.IMPLAUSIBLE.body.code);
      expect(await strikes(account.cookie)).toBe(6);
    });
  });
});
