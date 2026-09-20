import { describe, it, beforeAll, expect } from "@jest/globals";
import request from "supertest";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";

const api = request(TestData.BASE_URL);

describe("Save endpoints - unauthenticated", () => {
  it("GET /save returns 401", async () => {
    const res = await api.get("/save");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe(Responses.AUTH.UNAUTHORIZED.body.error);
  });

  it("PUT /save returns 401", async () => {
    const res = await api.put("/save").send(TestData.VALID_SAVE);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe(Responses.AUTH.UNAUTHORIZED.body.error);
  });

  it("DELETE /save returns 401", async () => {
    const res = await api.delete("/save");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe(Responses.AUTH.UNAUTHORIZED.body.error);
  });
});

describe("Save endpoints - authenticated", () => {
  let cookie: string;

  beforeAll(async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
    cookie = rawHeader.split(";")[0];
  });

  it("GET /save returns null when no save exists yet", async () => {
    const res = await api.get("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.save).toBeNull();
  });

  it("PUT /save returns 400 when required fields are missing", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_MISSING_FIELDS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.MISSING_FIELDS.body.error);
  });

  it("PUT /save returns 400 when units have an invalid shape", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_INVALID_UNITS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UNITS.body.error);
  });

  // Regression: a shape-valid units array with a duplicate unitId used to
  // reach upsertSave's createMany and 500 on UnitSave's unique constraint
  // instead of being caught as a 400 here, like isValidUpgrades already
  // catches a duplicate upgrade id.
  it("PUT /save returns 400 when units contain a duplicate unitId", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_DUPLICATE_UNIT_IDS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UNITS.body.error);
  });

  it("PUT /save returns 400 when a unit's unitId is not a known unit", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_UNKNOWN_UNIT_ID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UNITS.body.error);
  });

  it("PUT /save returns 400 when a unit's owned count is fractional", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_FRACTIONAL_UNIT_OWNED);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UNITS.body.error);
  });

  it("PUT /save returns 400 when a unit's owned count exceeds the hard ceiling", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_UNIT_OWNED_TOO_LARGE);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UNITS.body.error);
  });

  it("PUT /save returns 400 for negative tokens", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_NEGATIVE_TOKENS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_CORE_FIELDS.body.error);
  });

  it("PUT /save returns 400 for negative elapsedSeconds", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_NEGATIVE_ELAPSED);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_CORE_FIELDS.body.error);
  });

  it("PUT /save returns 400 for a fractional totalClicks", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_FRACTIONAL_TOTAL_CLICKS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_CORE_FIELDS.body.error);
  });

  it("PUT /save returns 400 for a negative totalClicks", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_NEGATIVE_TOTAL_CLICKS);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_CORE_FIELDS.body.error);
  });

  it("PUT /save returns 400 when totalClicks exceeds the Int32 column range", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_TOTAL_CLICKS_TOO_LARGE);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_CORE_FIELDS.body.error);
  });

  it("PUT /save returns 400 when tokens exceeds totalTokensEarned", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_TOKENS_EXCEED_EARNED);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.TOKENS_EXCEED_EARNED.body.error);
  });

  it("PUT /save creates a save and returns 200 with savedAt", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.VALID_SAVE);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);
    expect(typeof res.body.savedAt).toBe("string");
  });

  it("GET /save returns the newly created save data", async () => {
    const res = await api.get("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.save).not.toBeNull();
    expect(res.body.save.tokens).toBe(TestData.VALID_SAVE.tokens);
    expect(res.body.save.totalTokensEarned).toBe(TestData.VALID_SAVE.totalTokensEarned);
    expect(res.body.save.totalClicks).toBe(TestData.VALID_SAVE.totalClicks);
    expect(res.body.save.elapsedSeconds).toBe(TestData.VALID_SAVE.elapsedSeconds);
    expect(res.body.save.units).toHaveLength(TestData.VALID_SAVE.units.length);
  });

  it("PUT /save overwrites the save with new data", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.UPDATED_SAVE);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);
  });

  it("GET /save returns the updated values after overwrite", async () => {
    const res = await api.get("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.save.tokens).toBe(TestData.UPDATED_SAVE.tokens);
    expect(res.body.save.units).toHaveLength(TestData.UPDATED_SAVE.units.length);
    const alphaUnit = res.body.save.units.find((u: { unitId: string }) => u.unitId === "alpha");
    expect(alphaUnit?.owned).toBe(TestData.UPDATED_SAVE.units[0].owned);
  });

  it("DELETE /save resets the save and returns 200", async () => {
    const res = await api.delete("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.SAVE.RESET_SUCCESS.body.message);
  });

  it("DELETE /save is idempotent — returns 200 even when no save exists", async () => {
    const res = await api.delete("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("GET /save returns null after the save was deleted", async () => {
    const res = await api.get("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.save).toBeNull();
  });
});

describe("Save endpoints - prestige fields", () => {
  let cookie: string;

  beforeAll(async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
    cookie = rawHeader.split(";")[0];
  });

  it("PUT /save persists all five prestige fields", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.PRESTIGE_SAVE);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);
  });

  it("GET /save round-trips all five prestige fields", async () => {
    const res = await api.get("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.save.phdCount).toBe(TestData.PRESTIGE_SAVE.phdCount);
    expect(res.body.save.prestigeCount).toBe(TestData.PRESTIGE_SAVE.prestigeCount);
    expect(res.body.save.runTokensEarned).toBe(TestData.PRESTIGE_SAVE.runTokensEarned);
    expect(res.body.save.runClicks).toBe(TestData.PRESTIGE_SAVE.runClicks);
    expect(res.body.save.runSeconds).toBe(TestData.PRESTIGE_SAVE.runSeconds);
  });

  it("PUT /save with a legacy-shaped body (no prestige keys) preserves the stored prestige fields", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.LEGACY_SAVE);
    expect(res.status).toBe(200);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.status).toBe(200);
    expect(getRes.body.save.tokens).toBe(TestData.LEGACY_SAVE.tokens);
    // The prestige fields from the earlier PRESTIGE_SAVE write must survive
    // unchanged — omission preserves, it does not reset to zero.
    expect(getRes.body.save.phdCount).toBe(TestData.PRESTIGE_SAVE.phdCount);
    expect(getRes.body.save.prestigeCount).toBe(TestData.PRESTIGE_SAVE.prestigeCount);
  });
});

describe("Save endpoints - prestige defaults on first save", () => {
  let cookie: string;

  beforeAll(async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
    cookie = rawHeader.split(";")[0];
  });

  it("a legacy-shaped body as the very first save seeds run fields from lifetime fields", async () => {
    const putRes = await api.put("/save").set("Cookie", cookie).send(TestData.LEGACY_SAVE);
    expect(putRes.status).toBe(200);

    const res = await api.get("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.save.phdCount).toBe(0);
    expect(res.body.save.prestigeCount).toBe(0);
    expect(res.body.save.runTokensEarned).toBe(TestData.LEGACY_SAVE.totalTokensEarned);
    expect(res.body.save.runClicks).toBe(TestData.LEGACY_SAVE.totalClicks);
    expect(res.body.save.runSeconds).toBe(TestData.LEGACY_SAVE.elapsedSeconds);
  });
});

describe("Save endpoints - prestige validation", () => {
  let cookie: string;

  beforeAll(async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
    cookie = rawHeader.split(";")[0];
  });

  it("rejects a negative phdCount", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_NEGATIVE_PHD);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("rejects a fractional phdCount", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_FRACTIONAL_PHD);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("rejects a string phdCount", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_STRING_PHD);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("rejects a negative runTokensEarned", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_NEGATIVE_RUN);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("rejects a null prestigeCount", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_NULL_PRESTIGE_COUNT);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("rejects a phdCount beyond the Int column range with 400, not a 500", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_PHD_TOO_LARGE);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("regression: a missing-fields body with otherwise-valid prestige fields still returns MISSING_FIELDS", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.SAVE_MISSING_FIELDS, phdCount: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.MISSING_FIELDS.body.error);
  });

  it("regression: an invalid-units body with otherwise-valid prestige fields still returns INVALID_UNITS", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.SAVE_INVALID_UNITS, phdCount: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UNITS.body.error);
  });
});

describe("Save endpoints - upgrades", () => {
  let cookie: string;

  beforeAll(async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
    cookie = rawHeader.split(";")[0];
  });

  it("PUT /save persists owned upgrade ids", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_WITH_UPGRADES);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);
  });

  it("GET /save round-trips the upgrade list", async () => {
    const res = await api.get("/save").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.save.upgrades.sort()).toEqual(
      [...TestData.SAVE_WITH_UPGRADES.upgrades].sort()
    );
  });

  it("PUT /save replaces the upgrade list wholesale when present", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_UPDATED_UPGRADES);
    expect(res.status).toBe(200);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.upgrades).toEqual(TestData.SAVE_UPDATED_UPGRADES.upgrades);
  });

  it("PUT /save with no upgrades key preserves the stored upgrade list — omission is not deletion", async () => {
    const res = await api.put("/save").set("Cookie", cookie).send(TestData.SAVE_NO_UPGRADES_KEY);
    expect(res.status).toBe(200);

    const getRes = await api.get("/save").set("Cookie", cookie);
    expect(getRes.body.save.tokens).toBe(TestData.SAVE_NO_UPGRADES_KEY.tokens);
    // The upgrades from the immediately preceding write must survive unchanged.
    expect(getRes.body.save.upgrades).toEqual(TestData.SAVE_UPDATED_UPGRADES.upgrades);
  });

  it("GET /save returns an empty upgrades array (not an error) for a save with none", async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const freshCookie = (loginRes.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

    await api.put("/save").set("Cookie", freshCookie).send(TestData.SAVE_NO_UPGRADES_KEY);
    const res = await api.get("/save").set("Cookie", freshCookie);
    expect(res.body.save.upgrades).toEqual([]);
    expect(res.body.save.activeBoosters).toEqual([]);
  });
});

describe("Save endpoints - upgrades validation", () => {
  let cookie: string;

  beforeAll(async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
    cookie = rawHeader.split(";")[0];
  });

  it("rejects an unknown upgrade id", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_INVALID_UPGRADES_UNKNOWN_ID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UPGRADES.body.error);
  });

  it("rejects a non-array upgrades value", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_INVALID_UPGRADES_NOT_ARRAY);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UPGRADES.body.error);
  });

  it("regression: rejects a duplicate upgrade id with 400 rather than reaching Prisma and 500", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send(TestData.SAVE_INVALID_UPGRADES_DUPLICATE);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UPGRADES.body.error);
  });

  it("regression: a missing-fields body with an otherwise-valid upgrades array still returns MISSING_FIELDS", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.SAVE_MISSING_FIELDS, upgrades: ["chalk"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.MISSING_FIELDS.body.error);
  });

  it("regression: an invalid-prestige body with an otherwise-valid upgrades array still returns INVALID_PRESTIGE", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.SAVE_NEGATIVE_PHD, upgrades: ["chalk"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_PRESTIGE.body.error);
  });

  it("an invalid upgrades array is still caught even with an otherwise fully valid body (incl. prestige fields)", async () => {
    const res = await api
      .put("/save")
      .set("Cookie", cookie)
      .send({ ...TestData.PRESTIGE_SAVE, upgrades: ["not-a-real-upgrade"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(Responses.SAVE.INVALID_UPGRADES.body.error);
  });
});

// Regression for a real production bug: two upsertSave() calls for the SAME
// user (two tabs autosaving, or a manual "Sync" landing mid-autosave) race
// inside the transaction's unitSave.deleteMany + createMany and MariaDB can
// report a write conflict/deadlock (Prisma P2034), which storeSave's
// catch-all previously turned into a bare 500. See database/retry.ts.
describe("Save endpoints - concurrent writes for the same user", () => {
  it("every response is 200 when several PUT /save calls race for one user", async () => {
    const user = TestData.generateUser();
    await api.post("/auth/register").send(user);
    const loginRes = await api
      .post("/auth/login")
      .send({ email: user.email, password: user.password });
    const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
    const cookie = rawHeader.split(";")[0];

    const CONCURRENT_WRITES = 8;
    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_WRITES }, (_, i) =>
        api
          .put("/save")
          .set("Cookie", cookie)
          .send({
            ...TestData.VALID_SAVE,
            tokens: TestData.VALID_SAVE.tokens + i,
            units: [
              { unitId: "alpha", owned: i },
              { unitId: "beta", owned: i * 2 }
            ]
          })
      )
    );

    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);
    }

    // The save must still be internally consistent afterward — exactly one
    // gameSave row's worth of units, whichever write landed last.
    const finalGet = await api.get("/save").set("Cookie", cookie);
    expect(finalGet.status).toBe(200);
    expect(finalGet.body.save.units).toHaveLength(2);
  });

  it("running several users' racing writes in parallel is also all-200s", async () => {
    const users = await Promise.all(
      Array.from({ length: 4 }, async () => {
        const user = TestData.generateUser();
        await api.post("/auth/register").send(user);
        const loginRes = await api
          .post("/auth/login")
          .send({ email: user.email, password: user.password });
        const rawHeader = (loginRes.headers["set-cookie"] as unknown as string[])[0];
        return rawHeader.split(";")[0];
      })
    );

    const allWrites = users.flatMap((cookie) =>
      Array.from({ length: 4 }, (_, i) =>
        api
          .put("/save")
          .set("Cookie", cookie)
          .send({ ...TestData.VALID_SAVE, tokens: TestData.VALID_SAVE.tokens + i })
      )
    );

    const responses = await Promise.all(allWrites);
    for (const res of responses) {
      expect(res.status).toBe(200);
    }
  });
});
