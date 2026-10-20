import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";
import {
  evaluateSaveEnvelope,
  type PrevSaveSnapshot,
  type IncomingSave
} from "../services/saveValidator.js";
import { getCareerModifiers } from "../services/careerCore.js";
import { PHD_TOKEN_SCALE } from "../constants/gameBalance.js";
import { CLOCK_GRACE_SECS } from "../constants/antiCheat.js";

// Pure unit tests of the prestige-interval earnings bound (see
// services/saveValidator.ts's affordablePeakState).
//
// Regression, production incident 2026-10-20: with a big tree (kept units, a
// start fund, auto-buyers) and many PhDs, the leading player's runs took
// ~11 s — a whole run started, peaked and ended between two saves. The bound
// was built from the two run-START states on either side, never the run's
// peak, so the honest save was rejected and struck, and the client's retry
// after each restriction was struck again (a ban loop).
interface Incident {
  prev: Omit<PrevSaveSnapshot, "savedAt" | "career"> & { savedAt: string };
  careerNodeIds: string[];
  refused: {
    wallClockSecs: number;
    deltaElapsed: number;
    deltaClicks: number;
    deltaEarned: number;
    prestigeCount: number;
  };
}
const incident = JSON.parse(
  readFileSync(
    join(process.cwd(), "src", "tests", "fixtures", "incident-2026-10-20-prestige-run.json"),
    "utf8"
  )
) as Incident;

const prev: PrevSaveSnapshot = {
  ...incident.prev,
  savedAt: new Date(incident.prev.savedAt),
  career: getCareerModifiers(incident.careerNodeIds)
};
// The refused save reached the server this long after the stored one was
// written (minus the grace the envelope adds itself).
const now = new Date(
  prev.savedAt.getTime() + (incident.refused.wallClockSecs - CLOCK_GRACE_SECS) * 1000
);

// The refused save, rebuilt from what the rejection logged: a new run
// started from the same kept units and start fund, after one more prestige
// that paid floor(sqrt(run / scale)) PhDs.
function refusedSave(deltaEarned = incident.refused.deltaEarned): IncomingSave {
  return {
    tokens: prev.tokens,
    totalTokensEarned: prev.totalTokensEarned + deltaEarned,
    totalClicks: prev.totalClicks + incident.refused.deltaClicks,
    elapsedSeconds: prev.elapsedSeconds + incident.refused.deltaElapsed,
    phdCount: prev.phdCount + Math.floor(Math.sqrt(deltaEarned / PHD_TOKEN_SCALE)),
    prestigeCount: incident.refused.prestigeCount,
    units: prev.units,
    upgrades: []
  };
}

describe("evaluateSaveEnvelope — a whole run between two saves", () => {
  it("regression: accepts the leading player's refused save (a whole run between saves)", () => {
    expect(evaluateSaveEnvelope(prev, new Date(0), now, refusedSave())).toEqual({
      outcome: "accept"
    });
  });

  it("still rejects a claim far beyond what that interval's run could have earned", () => {
    const verdict = evaluateSaveEnvelope(
      prev,
      new Date(0),
      now,
      refusedSave(incident.refused.deltaEarned * 1000)
    );
    expect(verdict.outcome).toBe("reject");
    if (verdict.outcome === "reject") expect(verdict.reason).toBe("earnings_exceed_max_possible");
  });

  it("a non-prestige interval is unchanged: the same earnings without a prestige reject", () => {
    const save = { ...refusedSave(), prestigeCount: prev.prestigeCount, phdCount: prev.phdCount };
    const verdict = evaluateSaveEnvelope(prev, new Date(0), now, save);
    expect(verdict.outcome).toBe("reject");
  });
});

// A simulated honest player's save intervals through the real client save
// cadence (autosave every 30 s, or off — then only the sync right after each
// prestige), from 3 to 80 hours in, at 3 and 8 clicks/s. Generated from the
// real frontend game store by `pnpm sim:save-cadence` (frontend/src/utils/
// __tests__/save-cadence.sim.spec.ts). Before this fix the envelope rejected
// or materially clamped nearly every prestiged pair here — strikes, or a
// soft-clamp pattern on its way to one, for honest play.
interface HonestIntervals {
  purchaseOrder: string[];
  pairs: {
    source: string;
    hours: number;
    prestiged: boolean;
    wholeRun: boolean;
    dtMs: number;
    nodes: number;
    prev: Omit<PrevSaveSnapshot, "savedAt" | "career">;
    incoming: IncomingSave;
  }[];
}
const honest = JSON.parse(
  readFileSync(
    join(process.cwd(), "src", "tests", "fixtures", "honest-prestige-intervals.json"),
    "utf8"
  )
) as HonestIntervals;

describe("evaluateSaveEnvelope — honest play replayed through the client's save cadence", () => {
  it("the fixture covers early to late game, with and without autosave", () => {
    expect(honest.pairs.filter((p) => p.prestiged).length).toBeGreaterThanOrEqual(50);
    expect(honest.pairs.filter((p) => p.wholeRun).length).toBeGreaterThanOrEqual(40);
    expect(new Set(honest.pairs.map((p) => p.source)).size).toBe(3);
    expect(Math.max(...honest.pairs.map((p) => p.nodes))).toBeGreaterThan(200);
  });

  const kind = (p: HonestIntervals["pairs"][number]) =>
    p.wholeRun ? " (whole run)" : p.prestiged ? " (prestige)" : "";
  const cases = honest.pairs.map((p) => [`${p.source} @${p.hours}h${kind(p)}`, p] as const);
  it.each(cases)(
    "%s is accepted (a float-noise clamp at most, never a strike)",
    (_label, pair) => {
      const now = new Date(Date.UTC(2026, 9, 20, 12));
      const prevSave: PrevSaveSnapshot = {
        ...pair.prev,
        savedAt: new Date(now.getTime() - pair.dtMs),
        career: getCareerModifiers(honest.purchaseOrder.slice(0, pair.nodes))
      };
      const verdict = evaluateSaveEnvelope(prevSave, new Date(0), now, pair.incoming);
      if (verdict.outcome === "reject") throw new Error(`rejected: ${verdict.reason}`);
      if (verdict.outcome === "clamp") expect(verdict.material).toBe(false);
    }
  );
});

