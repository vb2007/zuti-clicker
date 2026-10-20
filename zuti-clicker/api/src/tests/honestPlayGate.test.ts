import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import {
  evaluateSaveEnvelope,
  graceLeadNeeds,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator.js";
import { decideGraceLead } from "../services/graceLead.js";
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

// The server measures an interval from when it EVALUATED the previous save,
// the client from when it took it: a slow previous upload (a mobile network)
// makes the server's interval shorter than the play it covers. Every interval
// must pass with this much of the fixed CLOCK_GRACE_SECS (5 s) already used
// up — even before the grace lead lends it more.
const LATENCY_MARGIN_MS = 4000;

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Upload latency (snapshot taken -> server evaluates): lognormal around 120 ms
// with a heavy tail, plus 1% stalls of 2-20 s (20 s is the client's timeout).
function latencyModel(seed: number): () => number {
  const random = seededRandom(seed);
  return () => {
    if (random() < 0.01) return 2 + random() * 18;
    const z = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    return 0.12 * Math.exp(1.2 * z);
  };
}

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

  // The grace lead is a property of a whole save chain, so each scenario is
  // replayed in order, over a network that delays every upload differently.
  // The client sends one save at a time: its next snapshot comes after the
  // previous reply, and its playtime keeps ticking while it waits (shifted
  // into both saves, which only ever makes a claim larger). No save may be
  // refused, earnings must never have refused one, and every verdict at the
  // grace the lead allows must still accept.
  it("every save chain fits its grace budget, over a heavy-tailed network", () => {
    const now = new Date(Date.UTC(2026, 9, 20, 12));
    const failures: string[] = [];
    let maxLead = 0;
    let maxNeed = 0;
    let maxEarningsLead = 0;
    for (const source of new Set(stream!.pairs.map((p) => p.source))) {
      const upload = latencyModel(source.length * 7919);
      const download = latencyModel(source.length * 104729);
      let simAt = 0; // the sim's own clock at the previous save
      let offset = 0; // how far real time has drifted past the sim's, waiting on replies
      let evaluatedAt = upload(); // when the server evaluated the previous save
      let prevOffset = 0;
      let lead = 0;
      let earningsLead = 0;
      for (const pair of stream!.pairs.filter((p) => p.source === source)) {
        const simNow = simAt + pair.dtMs / 1000;
        const takenAt = Math.max(simNow + offset, evaluatedAt + download());
        offset = takenAt - simNow;
        const at = takenAt + upload();
        const dtReal = at - evaluatedAt;
        const prev: PrevSaveSnapshot = {
          ...pair.prev,
          elapsedSeconds: pair.prev.elapsedSeconds + prevOffset,
          savedAt: new Date(now.getTime() - dtReal * 1000),
          career: getCareerModifiers(stream!.purchaseOrder.slice(0, pair.nodes))
        };
        const incoming = {
          ...pair.incoming,
          elapsedSeconds: pair.incoming.elapsedSeconds + offset
        };
        const needs = graceLeadNeeds(prev, incoming, dtReal);
        const d = decideGraceLead(lead, dtReal, needs);
        const shadow = decideGraceLead(earningsLead, dtReal, needs, true);
        const verdict = evaluateSaveEnvelope(
          prev,
          new Date(0),
          now,
          incoming,
          d.graceSecs,
          d.earningsGraceSecs
        );
        const where =
          `${pair.source} @${pair.hours}h ` +
          `(lead ${d.lead.toFixed(2)} s, dt ${dtReal.toFixed(2)} s)`;
        if (d.overBy > 0) failures.push(`${where}: refused, over by ${d.overBy}`);
        if (shadow.overBy > 0) failures.push(`${where}: earnings would refuse`);
        if (verdict.outcome === "reject" || (verdict.outcome === "clamp" && verdict.material)) {
          failures.push(`${where}: ${JSON.stringify(verdict)}`);
        }
        maxLead = Math.max(maxLead, d.nextLead);
        maxNeed = Math.max(maxNeed, d.need);
        lead = d.nextLead;
        earningsLead = shadow.nextLead;
        maxEarningsLead = Math.max(maxEarningsLead, shadow.nextLead);
        evaluatedAt = at;
        simAt = simNow;
        prevOffset = offset;
      }
    }
    console.log(
      `honest-play gate: largest grace lead ${maxLead.toFixed(2)} s, need ${maxNeed.toFixed(2)} s, ` +
        `with earnings ${maxEarningsLead.toFixed(2)} s`
    );
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
