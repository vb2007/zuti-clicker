import { describe, it, beforeAll, expect } from "@jest/globals";
import request from "supertest";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { prisma } from "../database/prisma.js";

const api = request(TestData.BASE_URL);

// Logs in with the given credentials and returns the session cookie.
async function login(email: string, password: string): Promise<string> {
  const res = await api.post("/auth/login").send({ email, password });
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// Registers a fresh test user, logs in, and returns their session cookie.
async function registerAndLogin(): Promise<string> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  return login(user.email, user.password);
}

// Values far larger than anything any other test file writes (the largest
// literal elsewhere is PRESTIGE_SAVE's totalTokensEarned at 1.2e7), so these
// test users are guaranteed to sit at the very top of the ranking regardless
// of what other test files write to the shared zutiClickerTest database
// concurrently.
const HUGE_TOKENS = 900_000_000_000;
const HUGE_CLICKS = 2_000_000_000; // still within MySQL's signed INT32 range
const HUGE_PHD = 2_000_000_000;
const HUGE_PLAYTIME = 900_000_000_000;

describe("Leaderboard endpoint - unauthenticated", () => {
  it("GET /leaderboard returns 401", async () => {
    const res = await api.get("/leaderboard");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe(Responses.AUTH.UNAUTHORIZED.body.error);
  });
});

describe("Leaderboard endpoint - validation", () => {
  let cookie: string;

  beforeAll(async () => {
    cookie = await registerAndLogin();
  });

  it("defaults to the tokens metric when none is given", async () => {
    const res = await api.get("/leaderboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.metric).toBe("tokens");
  });

  it("rejects an unknown metric", async () => {
    const res = await api.get("/leaderboard?metric=nonsense").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.LEADERBOARD.INVALID_METRIC.body.error);
  });

  it.each(["toString", "constructor", "hasOwnProperty", "valueOf"])(
    "regression: rejects an inherited Object.prototype key (%s) as a metric with 400, not 500",
    async (metric) => {
      const res = await api.get(`/leaderboard?metric=${metric}`).set("Cookie", cookie);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(Responses.LEADERBOARD.INVALID_METRIC.body.error);
    }
  );

  it("rejects limit=0", async () => {
    const res = await api.get("/leaderboard?limit=0").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.LEADERBOARD.INVALID_LIMIT.body.error);
  });

  it("rejects a negative limit", async () => {
    const res = await api.get("/leaderboard?limit=-1").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.LEADERBOARD.INVALID_LIMIT.body.error);
  });

  it("rejects a non-numeric limit", async () => {
    const res = await api.get("/leaderboard?limit=abc").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.LEADERBOARD.INVALID_LIMIT.body.error);
  });

  it("rejects a limit beyond the maximum", async () => {
    const res = await api.get("/leaderboard?limit=101").set("Cookie", cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.LEADERBOARD.INVALID_LIMIT.body.error);
  });

  it("returns null viewer standing when the requester has no save yet", async () => {
    const res = await api.get("/leaderboard").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.viewer).toBeNull();
  });
});

describe("Leaderboard endpoint - ranking", () => {
  let cookieA: string;
  let cookieB: string;
  let cookieC: string;
  let usernameA: string;
  let usernameB: string;
  let usernameC: string;

  beforeAll(async () => {
    const userA = TestData.generateUser();
    const userB = TestData.generateUser();
    const userC = TestData.generateUser();
    usernameA = userA.username;
    usernameB = userB.username;
    usernameC = userC.username;

    await api.post("/auth/register").send(userA);
    await api.post("/auth/register").send(userB);
    await api.post("/auth/register").send(userC);

    cookieA = await login(userA.email, userA.password);
    cookieB = await login(userB.email, userB.password);
    cookieC = await login(userC.email, userC.password);

    // A > B > C on every metric, all in the "huge" range so no other test
    // file's data can outrank them.
    await api
      .put("/save")
      .set("Cookie", cookieA)
      .send({
        ...TestData.LEADERBOARD_BASE_SAVE,
        totalTokensEarned: HUGE_TOKENS + 3,
        totalClicks: HUGE_CLICKS + 3,
        phdCount: HUGE_PHD + 3,
        elapsedSeconds: HUGE_PLAYTIME + 3
      });
    await api
      .put("/save")
      .set("Cookie", cookieB)
      .send({
        ...TestData.LEADERBOARD_BASE_SAVE,
        totalTokensEarned: HUGE_TOKENS + 2,
        totalClicks: HUGE_CLICKS + 2,
        phdCount: HUGE_PHD + 2,
        elapsedSeconds: HUGE_PLAYTIME + 2
      });
    await api
      .put("/save")
      .set("Cookie", cookieC)
      .send({
        ...TestData.LEADERBOARD_BASE_SAVE,
        totalTokensEarned: HUGE_TOKENS + 1,
        totalClicks: HUGE_CLICKS + 1,
        phdCount: HUGE_PHD + 1,
        elapsedSeconds: HUGE_PLAYTIME + 1
      });
  });

  it.each([
    ["tokens", HUGE_TOKENS + 3],
    ["clicks", HUGE_CLICKS + 3],
    ["phd", HUGE_PHD + 3],
    ["playtime", HUGE_PLAYTIME + 3]
  ])("ranks users descending by %s", async (metric, topValue) => {
    const res = await api.get(`/leaderboard?metric=${metric}`).set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.entries[0].username).toBe(usernameA);
    expect(res.body.entries[0].rank).toBe(1);
    expect(res.body.entries[0].value).toBe(topValue);
    expect(res.body.entries[1].username).toBe(usernameB);
    expect(res.body.entries[1].rank).toBe(2);
    expect(res.body.entries[2].username).toBe(usernameC);
    expect(res.body.entries[2].rank).toBe(3);
  });

  it("entries never expose userId or email — only rank, username, value", async () => {
    const res = await api.get("/leaderboard?metric=tokens").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.entries[0]).sort()).toEqual(["rank", "username", "value"]);
  });

  it("reports the viewer's own standing matching their entries rank", async () => {
    const res = await api.get("/leaderboard?metric=tokens").set("Cookie", cookieB);
    expect(res.status).toBe(200);
    expect(res.body.viewer.rank).toBe(2);
    expect(res.body.viewer.value).toBe(HUGE_TOKENS + 2);
    expect(res.body.viewer.hidden).toBe(false);
  });

  it("a viewer outside the requested limit is absent from entries but present in viewer", async () => {
    const res = await api.get("/leaderboard?metric=tokens&limit=2").set("Cookie", cookieC);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries.map((e: { username: string }) => e.username)).not.toContain(
      usernameC
    );
    expect(res.body.viewer.rank).toBe(3);
    expect(res.body.viewer.value).toBe(HUGE_TOKENS + 1);
  });
});

describe("Leaderboard endpoint - tie-break", () => {
  it("ties are broken deterministically by ascending userId (registration order)", async () => {
    // Registered back-to-back with no other registration in between, so
    // "first" reliably gets the smaller userId.
    const first = TestData.generateUser();
    const second = TestData.generateUser();
    await api.post("/auth/register").send(first);
    await api.post("/auth/register").send(second);

    const firstCookie = await login(first.email, first.password);
    const secondCookie = await login(second.email, second.password);

    const tiedValue = HUGE_TOKENS + 500; // a slot untouched by the ranking describe block above
    await api
      .put("/save")
      .set("Cookie", firstCookie)
      .send({ ...TestData.LEADERBOARD_BASE_SAVE, totalTokensEarned: tiedValue });
    await api
      .put("/save")
      .set("Cookie", secondCookie)
      .send({ ...TestData.LEADERBOARD_BASE_SAVE, totalTokensEarned: tiedValue });

    const res = await api.get("/leaderboard?metric=tokens").set("Cookie", firstCookie);
    const firstIndex = res.body.entries.findIndex(
      (e: { username: string }) => e.username === first.username
    );
    const secondIndex = res.body.entries.findIndex(
      (e: { username: string }) => e.username === second.username
    );
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(secondIndex);
    expect(res.body.entries[secondIndex].rank).toBe(res.body.entries[firstIndex].rank + 1);
  });
});

describe("Leaderboard endpoint - opt-out", () => {
  it("an opted-out player is excluded from others' entries but sees their own hidden standing", async () => {
    const visible = TestData.generateUser();
    const hidden = TestData.generateUser();
    await api.post("/auth/register").send(visible);
    await api.post("/auth/register").send(hidden);

    const visibleCookie = await login(visible.email, visible.password);
    const hiddenCookie = await login(hidden.email, hidden.password);

    const hiddenValue = HUGE_TOKENS + 999; // isolated slot
    const visibleValue = HUGE_TOKENS + 998;
    await api
      .put("/save")
      .set("Cookie", hiddenCookie)
      .send({ ...TestData.LEADERBOARD_BASE_SAVE, totalTokensEarned: hiddenValue });
    await api
      .put("/save")
      .set("Cookie", visibleCookie)
      .send({ ...TestData.LEADERBOARD_BASE_SAVE, totalTokensEarned: visibleValue });

    const optOutRes = await api
      .put("/settings")
      .set("Cookie", hiddenCookie)
      .send({ hideFromLeaderboards: true });
    expect(optOutRes.status).toBe(200);

    const othersView = await api.get("/leaderboard?metric=tokens").set("Cookie", visibleCookie);
    expect(
      othersView.body.entries.map((e: { username: string }) => e.username)
    ).not.toContain(hidden.username);

    const ownView = await api.get("/leaderboard?metric=tokens").set("Cookie", hiddenCookie);
    expect(
      ownView.body.entries.map((e: { username: string }) => e.username)
    ).not.toContain(hidden.username);
    expect(ownView.body.viewer.hidden).toBe(true);
    expect(ownView.body.viewer.value).toBe(hiddenValue);
    // Rank is computed among visible players only — the opted-out player's
    // own row never counts as competition for themselves.
    expect(ownView.body.viewer.rank).toBe(1);
  });
});

describe("Leaderboard endpoint - restricted players", () => {
  it("a restricted player is excluded from others' entries but sees their own standing", async () => {
    const visible = TestData.generateUser();
    const restricted = TestData.generateUser();
    await api.post("/auth/register").send(visible);
    await api.post("/auth/register").send(restricted);

    const visibleCookie = await login(visible.email, visible.password);
    const restrictedCookie = await login(restricted.email, restricted.password);
    const meRes = await api.get("/auth/me").set("Cookie", restrictedCookie);
    const restrictedUserId: number = meRes.body.user.id;

    const restrictedValue = HUGE_TOKENS + 799; // isolated slot
    const visibleValue = HUGE_TOKENS + 798;
    await api
      .put("/save")
      .set("Cookie", restrictedCookie)
      .send({ ...TestData.LEADERBOARD_BASE_SAVE, totalTokensEarned: restrictedValue });
    await api
      .put("/save")
      .set("Cookie", visibleCookie)
      .send({ ...TestData.LEADERBOARD_BASE_SAVE, totalTokensEarned: visibleValue });

    // No endpoint sets an arbitrary restriction directly (by design) — this
    // is the one place in the suite that reaches past the API to set up a
    // precondition the anti-cheat system itself would otherwise take real
    // strikes to reach.
    await prisma.antiCheatState.upsert({
      where: { userId: restrictedUserId },
      update: { restrictedUntil: new Date(Date.now() + 60_000), strikeCount: 1 },
      create: { userId: restrictedUserId, restrictedUntil: new Date(Date.now() + 60_000), strikeCount: 1 }
    });

    const othersView = await api.get("/leaderboard?metric=tokens").set("Cookie", visibleCookie);
    expect(
      othersView.body.entries.map((e: { username: string }) => e.username)
    ).not.toContain(restricted.username);

    const ownView = await api.get("/leaderboard?metric=tokens").set("Cookie", restrictedCookie);
    expect(ownView.body.viewer.value).toBe(restrictedValue);

    // Once the restriction lifts, there is no lasting exclusion.
    await prisma.antiCheatState.update({
      where: { userId: restrictedUserId },
      data: { restrictedUntil: new Date(Date.now() - 1000) }
    });
    const afterExpiry = await api.get("/leaderboard?metric=tokens").set("Cookie", visibleCookie);
    expect(
      afterExpiry.body.entries.map((e: { username: string }) => e.username)
    ).toContain(restricted.username);
  });
});
