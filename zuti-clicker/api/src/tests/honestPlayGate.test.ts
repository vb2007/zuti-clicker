import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import {
  evaluateSaveEnvelope,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator.js";
import { getCareerModifiers } from "../services/careerCore.js";

// The honest-play gate (CI's "Honest play" job). Every false ban so far came
// from the envelope not fitting something an honest client really does —
// prestige and an autosave in one interval, a guest's playtime before the
// account, a whole run between two saves. Nothing ran the real client against
// these bounds until the last of those, so this gate does it on every PR: the
// frontend's save-cadence sim (`pnpm sim:honest-play-gate`) plays the real
// game store through the real client save cadence and writes EVERY interval
// to HONEST_PLAY_FILE; each one must pass the real envelope. A new mechanic,
// or a bound tightened, that an honest player can fall foul of fails here
// instead of in production.
//
// Skipped when HONEST_PLAY_FILE isn't set (an ordinary local or api-tests
// run). The committed sample in prestigeIntervalEnvelope.test.ts always runs.
const file = process.env["HONEST_PLAY_FILE"];

interface Stream {
  purchaseOrder: string[];
  pairs: {
    source: string;
    hours: number;
    prestiged: boolean;
    dtMs: number;
    nodes: number;
    prev: Omit<PrevSaveSnapshot, "savedAt" | "career">;
    incoming: IncomingSave;
  }[];
}

// The server measures an interval from when it WROTE the previous save, the
// client from when it took it: a slow previous request (a mobile network, a
// wait behind a spin's row lock) makes the server's interval shorter than the
// play it covers. CLOCK_GRACE_SECS (5 s) absorbs that; every interval must
// still pass with this much of it already used up.
const LATENCY_MARGIN_MS = 4000;

(file ? describe : describe.skip)("honest-play gate", () => {
  const stream = file ? (JSON.parse(readFileSync(file, "utf8")) as Stream) : null;

  it("every honest interval passes the envelope, even with network latency", () => {
    const now = new Date(Date.UTC(2026, 9, 20, 12));
    const failures: string[] = [];
    for (const pair of stream!.pairs) {
      const career = getCareerModifiers(stream!.purchaseOrder.slice(0, pair.nodes));
      for (const latencyMs of [0, LATENCY_MARGIN_MS]) {
        const prev: PrevSaveSnapshot = {
          ...pair.prev,
          savedAt: new Date(now.getTime() - Math.max(0, pair.dtMs - latencyMs)),
          career
        };
        const verdict = evaluateSaveEnvelope(prev, new Date(0), now, pair.incoming);
        if (verdict.outcome === "accept" || (verdict.outcome === "clamp" && !verdict.material)) {
          continue;
        }
        const what =
          verdict.outcome === "reject"
            ? `reject ${verdict.reason}`
            : `material clamp ${verdict.reasons.join("+")}`;
        failures.push(
          `${pair.source} @${pair.hours}h (${pair.prestiged ? "prestige" : "plain"}, ` +
            `latency ${latencyMs} ms): ${what} ${JSON.stringify(verdict.detail)}`
        );
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
    expect(failures).toHaveLength(0);
  });

  // A passing gate means nothing if the sim stopped exercising what it is for.
  it("the stream covers what it is meant to", () => {
    const pairs = stream!.pairs;
    const bySource = (name: string) => pairs.filter((p) => p.source.includes(name));
    for (const source of new Set(pairs.map((p) => p.source))) {
      expect(pairs.filter((p) => p.source === source).length).toBeGreaterThan(1_000);
    }
    // Whole runs between saves, deep into the Academic Career.
    const wholeRuns = bySource("autosaveOff");
    expect(wholeRuns.filter((p) => p.prestiged).length).toBeGreaterThan(5_000);
    expect(Math.max(...wholeRuns.map((p) => p.nodes))).toBeGreaterThan(200);
    // Wheel spins that actually moved PhDs between saves.
    const spun = bySource("spins").filter((p) => p.prev.upgraderNet !== 0);
    expect(spun.length).toBeGreaterThan(100);
    // A heavy clicker.
    expect(bySource("cps20").length).toBeGreaterThan(1_000);
  });
});
