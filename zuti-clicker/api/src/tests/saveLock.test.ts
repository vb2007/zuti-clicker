import { describe, it, beforeAll, expect } from "@jest/globals";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import request from "supertest";
import { TestData } from "../constants/test-data.js";
import { Responses } from "../constants/responses.js";
import { prisma } from "../database/prisma.js";
import { withSaveTransaction } from "../database/saveTransaction.js";

const api = request(TestData.BASE_URL);

// How long the tests below hold a GameSave lock open, and how fast a request
// that must NOT be waiting on it has to finish meanwhile.
const HOLD_MS = 1500;
const UNBLOCKED_MS = 1000;

// Registers a fresh test user (no save yet), logs in, and returns the
// session cookie plus the user's id.
async function freshUser(): Promise<{ cookie: string; userId: number }> {
  const user = TestData.generateUser();
  await api.post("/auth/register").send(user);
  const res = await api.post("/auth/login").send({ email: user.email, password: user.password });
  const cookie = (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
  const row = await prisma.user.findUniqueOrThrow({
    where: { email: user.email },
    select: { id: true }
  });
  return { cookie, userId: row.id };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Times a request from the moment it is sent.
async function timed<T>(send: () => PromiseLike<T>): Promise<{ res: T; ms: number }> {
  const start = Date.now();
  const res = await send();
  return { res, ms: Date.now() - start };
}

// Regression for the Academic Career PR's CI stall: the save writers took
// their row lock with `WHERE userId = ? FOR UPDATE`, which on a user with no
// save yet is an InnoDB GAP lock — it blocked every other new user's first
// save until it was released, and under the parallel suite that piled up
// into 20 s+ request stalls. See database/saveTransaction.ts.
describe("GameSave row locks", () => {
  it("every locking read on GameSave in the models locks by primary key, never by userId", () => {
    const dir = join(process.cwd(), "src", "database", "models");
    const offenders: string[] = [];
    let locks = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      const lockReads = source.matchAll(/FROM\s+GameSave\s+WHERE\s+(\w+)\s*=[^`]*?FOR UPDATE/g);
      for (const match of lockReads) {
        locks++;
        if (match[1] !== "id") offenders.push(`${file}: WHERE ${match[1]} = … FOR UPDATE`);
      }
    }
    // PUT /save, the wheel spin, the booster claim and the career endpoints —
    // a lower count means the pattern above stopped matching, not that the
    // locks went away.
    expect(locks).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  describe("while one user's save is locked", () => {
    let locked: { cookie: string; userId: number };
    let other: { cookie: string; userId: number };

    beforeAll(async () => {
      locked = await freshUser();
      other = await freshUser();
      const first = await api.put("/save").set("Cookie", locked.cookie).send(TestData.VALID_SAVE);
      expect(first.status).toBe(200);
    });

    it("another user's first save goes straight through; the owner's own save waits", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let lockTaken!: () => void;
      const taken = new Promise<void>((resolve) => (lockTaken = resolve));

      // The same lock the save writers take, held open on purpose.
      const holder = withSaveTransaction(
        locked.userId,
        async (tx, saveId) => {
          expect(saveId).not.toBeNull();
          await tx.$queryRaw`SELECT id FROM GameSave WHERE id = ${saveId} FOR UPDATE`;
          lockTaken();
          await held;
        }
      );
      await taken;
      const releaseTimer = setTimeout(release, HOLD_MS);

      const [otherSave, ownSave] = await Promise.all([
        timed(() => api.put("/save").set("Cookie", other.cookie).send(TestData.VALID_SAVE)),
        timed(() => api.put("/save").set("Cookie", locked.cookie).send(TestData.UPDATED_SAVE))
      ]);
      await holder;
      clearTimeout(releaseTimer);

      expect(otherSave.res.status).toBe(200);
      expect(otherSave.res.body.message).toBe(Responses.SAVE.SAVE_SUCCESS.body.message);
      expect(otherSave.ms).toBeLessThan(UNBLOCKED_MS);
      // The lock is real: the owner's save only lands once it is released.
      expect(ownSave.res.status).toBe(200);
      expect(ownSave.ms).toBeGreaterThanOrEqual(UNBLOCKED_MS);
    });
  });

  it("a transaction for a user with no save is handed no id and locks nothing", async () => {
    const saveless = await freshUser();
    const other = await freshUser();

    const holder = withSaveTransaction(
      saveless.userId,
      async (_tx, saveId) => {
        expect(saveId).toBeNull();
        await sleep(HOLD_MS);
      }
    );
    const otherSave = await timed(() =>
      api.put("/save").set("Cookie", other.cookie).send(TestData.VALID_SAVE)
    );
    await holder;

    expect(otherSave.res.status).toBe(200);
    expect(otherSave.ms).toBeLessThan(UNBLOCKED_MS);
  });

  it("career, booster and wheel endpoints still answer no-save without a save", async () => {
    const saveless = await freshUser();
    const [buy, close, claim, spin] = await Promise.all([
      api.post("/career/buy").set("Cookie", saveless.cookie).send({ nodeId: "habilitation" }),
      api.post("/career/close").set("Cookie", saveless.cookie).send({}),
      api.post("/boosters/claim").set("Cookie", saveless.cookie).send({}),
      api.post("/upgrader/spin").set("Cookie", saveless.cookie).send({ stake: 10, multiplier: 2 })
    ]);
    expect(buy.status).toBe(Responses.CAREER.NO_SAVE.status);
    expect(buy.body.error).toBe(Responses.CAREER.NO_SAVE.body.error);
    expect(close.status).toBe(Responses.CAREER.NO_SAVE.status);
    expect(close.body.error).toBe(Responses.CAREER.NO_SAVE.body.error);
    expect(claim.status).toBe(Responses.BOOSTER.NO_SAVE.status);
    expect(claim.body.error).toBe(Responses.BOOSTER.NO_SAVE.body.error);
    expect(spin.status).toBe(Responses.UPGRADER.NO_SAVE.status);
    expect(spin.body.error).toBe(Responses.UPGRADER.NO_SAVE.body.error);
  });
});
