import { describe, it, expect } from "@jest/globals";
import request from "supertest";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import {
  BOOSTER_IDS,
  BOOSTER_DURATION_SECS,
  BOOSTER_COOLDOWN_MIN_SECS,
  BOOSTER_COOLDOWN_MAX_SECS,
  CAREER_BOOSTER_DURATION_SECS
} from "../constants/boosters.js";
import {
  buildBoosterPool,
  pickWeightedBoosterId,
  boosterDurationMs,
  rollCooldownMs,
  boosterSpawnDivisor
} from "../services/boosters.js";
import { CAREER_CAPS, emptyCareerModifiers, getCareerModifiers } from "../services/careerCore.js";
import { getWindfallGrant } from "../services/economy.js";

const NONE = new Set<string>();
const mods = (o: Partial<ReturnType<typeof emptyCareerModifiers>>) => ({
  ...emptyCareerModifiers(),
  ...o
});

describe("booster rules (pure)", () => {
  it("the pool is the base three, plus career boosters only once unlocked", () => {
    expect(buildBoosterPool(emptyCareerModifiers())).toEqual([...BOOSTER_IDS]);
    expect(buildBoosterPool(mods({ unlockedBoosters: ["critStorm"] }))).toEqual([
      ...BOOSTER_IDS,
      "critStorm"
    ]);
    expect(buildBoosterPool(mods({ unlockedBoosters: ["windfall", "critStorm"] }))).toEqual([
      ...BOOSTER_IDS,
      "windfall",
      "critStorm"
    ]);
  });

  it("the weighted pick covers the whole pool, end to end", () => {
    const pool = buildBoosterPool(mods({ unlockedBoosters: ["windfall", "critStorm"] }));
    expect(pickWeightedBoosterId(pool, () => 0)).toBe("frenzy");
    expect(pickWeightedBoosterId(pool, () => 0.999999)).toBe("critStorm");
    // Base weights 4+4+3, career 3+3: windfall starts at 11/17.
    expect(pickWeightedBoosterId(pool, () => 11.5 / 17)).toBe("windfall");
  });

  it("durations add conferenceBadge and the tree's duration bonus", () => {
    expect(boosterDurationMs("frenzy", NONE, emptyCareerModifiers())).toBe(60_000);
    expect(boosterDurationMs("frenzy", new Set(["conferenceBadge"]), emptyCareerModifiers())).toBe(
      78_000
    );
    expect(
      boosterDurationMs("frenzy", new Set(["conferenceBadge"]), mods({ boosterDurationPct: 0.5 }))
    ).toBe(108_000);
    expect(boosterDurationMs("critStorm", NONE, emptyCareerModifiers())).toBe(30_000);
    expect(boosterDurationMs("windfall", NONE, mods({ boosterDurationPct: 1 }))).toBe(0);
  });

  it("cooldowns divide by newsletter + tree spawn bonus, capped, never below the floor", () => {
    const rng = () => 0; // the window's lower edge: 60 s
    expect(rollCooldownMs(NONE, emptyCareerModifiers(), rng)).toBe(60_000);
    expect(rollCooldownMs(new Set(["departmentNewsletter"]), emptyCareerModifiers(), rng)).toBe(
      45_000
    );
    expect(boosterSpawnDivisor(NONE, mods({ boosterSpawnPct: 10 }))).toBe(
      CAREER_CAPS.boosterSpawnDivisor
    );
    expect(rollCooldownMs(NONE, mods({ boosterSpawnPct: 10 }), rng)).toBe(
      Math.max(
        CAREER_CAPS.boosterCooldownFloorSecs,
        BOOSTER_COOLDOWN_MIN_SECS / CAREER_CAPS.boosterSpawnDivisor
      ) * 1000
    );
  });
});

const api = request(TestData.BASE_URL);

async function registerAndLogin(): Promise<string> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
  return (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
}

// The ambient server runs in "monitor", so any PhD balance can be seeded.
// Buys `nodes` in order inside the window a first prestige-carrying save opens.
async function accountWithNodes(nodes: string[], units = TestData.VALID_SAVE.units) {
  const cookie = await registerAndLogin();
  const seed = await api
    .put("/save")
    .set("Cookie", cookie)
    .send({ ...TestData.VALID_SAVE, units, phdCount: 5000, prestigeCount: 1 });
  expect(seed.status).toBe(200);
  for (const nodeId of nodes) {
    const res = await api.post("/career/buy").set("Cookie", cookie).send({ nodeId });
    expect(res.status).toBe(200);
  }
  return cookie;
}

const CONFERENCES = [
  "habilitation",
  "conferences.conferenceSeason",
  "conferences.callForPapers",
  "conferences.posterSession",
  "conferences.keynoteSpeaker"
];

describe("POST /boosters/claim with Academic Career nodes", () => {
  it("lengthens buffs and shortens the cooldown by the account's own nodes", async () => {
    const nodes = CONFERENCES.slice(0, 3); // +25% duration, +15% spawn rate
    const cookie = await accountWithNodes(nodes);
    const m = getCareerModifiers(nodes);
    const res = await api.post("/boosters/claim").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.BOOSTER.CLAIM_SUCCESS.body.message);
    expect(BOOSTER_IDS as readonly string[]).toContain(res.body.boosterId);
    const id = res.body.boosterId as (typeof BOOSTER_IDS)[number];
    expect(res.body.remainingMs).toBeCloseTo(BOOSTER_DURATION_SECS[id] * 1000 * 1.25, 6);
    expect(res.body.nextAvailableInMs).toBeLessThanOrEqual(
      (BOOSTER_COOLDOWN_MAX_SECS * 1000) / (1 + m.boosterSpawnPct) + 1
    );
    expect(res.body.windfall).toBeUndefined();
  });

  it("windfall credits its grant to the save itself, bumps upgraderSeq and leaves no buff row", async () => {
    // Windfall is 3 of the pool's 14 weight: try fresh accounts until it comes
    // up (60 attempts all missing has probability < 1e-6).
    const units = [
      { unitId: "alpha", owned: 30 },
      { unitId: "gamma", owned: 4 }
    ];
    const expectedGrant = (phd: number) =>
      getWindfallGrant(units, phd, getCareerModifiers(CONFERENCES));
    for (let attempt = 0; attempt < 60; attempt++) {
      const cookie = await accountWithNodes(CONFERENCES, units);
      const before = (await api.get("/save").set("Cookie", cookie)).body.save;
      const res = await api.post("/boosters/claim").set("Cookie", cookie);
      expect(res.status).toBe(200);
      if (res.body.boosterId !== "windfall") continue;

      expect(res.body.remainingMs).toBe(CAREER_BOOSTER_DURATION_SECS.windfall);
      expect(res.body.windfall.granted).toBeCloseTo(expectedGrant(before.phdCount), 6);
      expect(res.body.windfall.granted).toBeGreaterThan(0);
      expect(res.body.windfall.upgraderSeq).toBe(before.upgraderSeq + 1);

      const after = (await api.get("/save").set("Cookie", cookie)).body.save;
      expect(after.tokens).toBeCloseTo(before.tokens + res.body.windfall.granted, 6);
      expect(after.totalTokensEarned).toBeCloseTo(
        before.totalTokensEarned + res.body.windfall.granted,
        6
      );
      expect(after.runTokensEarned).toBeCloseTo(
        before.runTokensEarned + res.body.windfall.granted,
        6
      );
      expect(after.upgraderSeq).toBe(before.upgraderSeq + 1);
      expect(after.activeBoosters.map((b: { boosterId: string }) => b.boosterId)).not.toContain(
        "windfall"
      );

      // A save from before the grant is now stale, so it can't wipe the tokens.
      const stale = await api
        .put("/save")
        .set("Cookie", cookie)
        .send({ ...TestData.VALID_SAVE, units, upgraderSeq: before.upgraderSeq });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe(Responses.SAVE.STALE.body.code);
      return;
    }
    throw new Error("no windfall in 60 claims");
  });

  it("an account that never unlocked them is never offered the career boosters", async () => {
    const cookie = await accountWithNodes(["habilitation"]);
    const res = await api.post("/boosters/claim").set("Cookie", cookie);
    expect(BOOSTER_IDS as readonly string[]).toContain(res.body.boosterId);
  });
});
