import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { setActivePinia, createPinia } from "pinia";
import { useGameStore } from "@/stores/gameStore";
import { CAREER_NODES, careerBuyRefusal } from "@/utils/careerCore";
import { getWindfallGrant } from "@/utils/careerEconomy";
import { pickWeightedBoosterId } from "@/utils/upgrades";
import { runAutoBuy } from "@/composables/useAutoBuyer";
import { settleSpin } from "@/utils/upgrader";
import {
  UNIT_DEFINITIONS,
  UPGRADE_DEFINITIONS,
  BOOSTER_DEFINITIONS,
  BOOSTER_SPAWN_MIN_SECS,
  BOOSTER_SPAWN_MAX_SECS
} from "@/utils/gameConstants";

// Generates api/src/tests/fixtures/honest-prestige-intervals.json — the save
// intervals of an honest player, as the server sees them, for the API's
// prestigeIntervalEnvelope.test.ts. Skipped by default; run with
// `pnpm sim:save-cadence` (SAVE_CADENCE_SIM=1). It drives the REAL game store
// and follows the real client's save cadence: an autosave every
// AUTOSAVE_SECS (or none), the sync right after every prestige, and the flush
// before every Academic Career purchase, spin and windfall claim. The
// server's side is mirrored the way it really changes between saves: career
// purchases lower the stored PhDs, a windfall adds to the stored tokens.
//
// The player is the shape behind the 2026-10-20 incident: fast runs (a
// prestige as soon as the PhD rate peaks, from 10 s on), auto-buyers once the
// tree has them, half of every prestige's PhDs invested. Each scenario is
// sampled evenly over time — the prestige intervals (the hard case: a whole
// run between two saves) and a few plain ones as controls.
const RUN = process.env["SAVE_CADENCE_SIM"] === "1";
// SIM_FULL_OUT writes EVERY interval of every scenario there instead of the
// sampled fixture; SIM_SCENARIOS (a JSON array of Scenario) and SIM_HOURS
// replace the defaults — for wider sweeps than the committed fixture. A full
// stream keeps each scenario's saves in the order they were made, for the
// gate's replay of a whole save chain (the grace lead).
// SIM_PRESET=gate is CI's honest-play gate (.github/workflows/ci.yml): a
// shorter, broader set whose every interval the API replays through the real
// envelope (api/src/tests/honestPlayGate.test.ts).
const FULL_OUT = process.env["SIM_FULL_OUT"];
const OUT = FULL_OUT ?? "../api/src/tests/fixtures/honest-prestige-intervals.json";
const DT = 1;
const GATE = process.env["SIM_PRESET"] === "gate";
const HOURS = Number(process.env["SIM_HOURS"] ?? (GATE ? 30 : 80));

interface Scenario {
  source: string;
  autosaveSecs: number; // 0 = autosave off
  cps: number;
  prestiged: number; // prestige intervals sampled into the fixture
  plain: number; // plain intervals sampled into the fixture
  minRunSecs?: number; // the shortest run before a prestige (default 10)
  investShare?: number; // the share of held PhDs invested per window (default 0.5)
  spinEverySecs?: number; // an upgrader spin this often, 0 = never (default)
  hours?: number; // simulated hours (default HOURS)
}
const DEFAULT_SCENARIOS: Scenario[] = [
  { source: "autosave30-cps3", autosaveSecs: 30, cps: 3, prestiged: 24, plain: 4 },
  { source: "autosaveOff-cps8", autosaveSecs: 0, cps: 8, prestiged: 24, plain: 1 },
  { source: "autosave30-cps8", autosaveSecs: 30, cps: 8, prestiged: 16, plain: 4 }
];
// Whole runs between saves deep into the tree; spins at a steady pace; a heavy
// clicker on a short autosave.
const GATE_SCENARIOS: Scenario[] = [
  // 80 h: the deep tree (200+ nodes) only arrives in the second half.
  { source: "gate-autosaveOff-cps8", autosaveSecs: 0, cps: 8, prestiged: 0, plain: 0, hours: 80 },
  // Deep enough into the tree that spins land on a big economy too.
  {
    source: "gate-autosave30-cps8-spins",
    autosaveSecs: 30,
    cps: 8,
    prestiged: 0,
    plain: 0,
    spinEverySecs: 120,
    hours: 50
  },
  { source: "gate-autosave15-cps20", autosaveSecs: 15, cps: 20, prestiged: 0, plain: 0 }
];
const SCENARIOS: Scenario[] = process.env["SIM_SCENARIOS"]
  ? (JSON.parse(process.env["SIM_SCENARIOS"]) as Scenario[])
  : GATE
    ? GATE_SCENARIOS
    : DEFAULT_SCENARIOS;

type Game = ReturnType<typeof useGameStore>;
type Payload = ReturnType<Game["toSavePayload"]>;

interface ServerSave {
  tokens: number;
  totalTokensEarned: number;
  totalClicks: number;
  elapsedSeconds: number;
  phdCount: number;
  prestigeCount: number;
  upgraderNet: number;
  phdInvested: number;
  units: { unitId: string; owned: number }[];
  upgrades: string[];
}

interface Pair {
  source: string;
  hours: number;
  prestiged: boolean;
  // The previous save was the one right after a prestige: this interval holds
  // a whole run — the shape of the 2026-10-20 incident.
  wholeRun: boolean;
  dtMs: number;
  nodes: number;
  prev: ServerSave;
  incoming: Omit<ServerSave, "upgraderNet" | "phdInvested">;
}

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

function buyGreedy(game: Game) {
  for (let guard = 0; guard < 300; guard++) {
    let best: string | null = null;
    let bestRatio = Infinity;
    let bestCost = Infinity;
    for (const def of UNIT_DEFINITIONS) {
      if (!game.isUnitRevealed(def.id)) continue;
      const cost = game.getBuyCost(def.id, 1);
      const prod = def.baseProduction * (game.careerModifiers.unitProductionMult[def.id] ?? 1);
      if (cost / prod < bestRatio) {
        bestRatio = cost / prod;
        best = def.id;
        bestCost = cost;
      }
    }
    const upgrade = UPGRADE_DEFINITIONS.find(
      (d) =>
        !game.isUpgradeOwned(d.id) &&
        game.canAffordUpgrade(d.id) &&
        game.getUpgradeCost(d.id) <= bestCost * 3
    );
    if (upgrade && game.buyUpgrade(upgrade.id)) continue;
    if (best === null || !game.buyUnit(best, 1)) return;
  }
}

// `beforeEach` is the flush the client makes before every purchase;
// `afterEach` mirrors the server settling it on the stored save.
function invest(game: Game, share: number, beforeEach: () => void, afterEach: () => void) {
  const keep = Math.floor(game.phdCount * (1 - share));
  for (;;) {
    const next = CAREER_NODES.filter(
      (n) => careerBuyRefusal(n.id, game.careerNodeIds, game.phdCount - keep) === null
    ).sort((a, b) => a.cost - b.cost)[0];
    if (!next) return;
    beforeEach();
    if (!game.buyCareerNodeLocal(next.id)) return;
    afterEach();
  }
}

function incomingOf(p: Payload): Pair["incoming"] {
  return {
    tokens: p.tokens,
    totalTokensEarned: p.totalTokensEarned,
    totalClicks: p.totalClicks,
    elapsedSeconds: p.elapsedSeconds,
    phdCount: p.phdCount ?? 0,
    prestigeCount: p.prestigeCount ?? 0,
    units: p.units,
    upgrades: p.upgrades ?? []
  };
}

/** Plays one scenario; returns every save pair and the order nodes were bought in. */
function play(s: Scenario): { pairs: Pair[]; order: string[] } {
  const minRunSecs = s.minRunSecs ?? 10;
  const spinEvery = s.spinEverySecs ?? 0;
  vi.useFakeTimers({ now: 0 });
  vi.spyOn(Math, "random").mockImplementation(seededRandom(1));
  setActivePinia(createPinia());
  const game = useGameStore();
  const pairs: Pair[] = [];
  const order: string[] = [];
  let t = 0;
  let prev: ServerSave | null = null;
  let prevAt = 0;
  let prevAfterPrestige = false;
  let nodes = 0;
  let nextBooster = (BOOSTER_SPAWN_MIN_SECS + BOOSTER_SPAWN_MAX_SECS) / 2;
  let bestRate = 0;
  let lastAutoBuy = 0;
  let lastSpin = 0;
  let seq = 0;

  const save = (afterPrestige = false) => {
    const incoming = incomingOf(game.toSavePayload());
    if (prev) {
      const prestiged = incoming.prestigeCount > prev.prestigeCount;
      pairs.push({
        source: s.source,
        hours: +(t / 3600).toFixed(3),
        prestiged,
        wholeRun: prestiged && prevAfterPrestige,
        dtMs: (t - prevAt) * 1000,
        nodes,
        prev,
        incoming
      });
    }
    prev = { ...incoming, upgraderNet: prev?.upgraderNet ?? 0, phdInvested: game.phdInvested };
    prevAt = t;
    prevAfterPrestige = afterPrestige;
  };

  save();
  while (t < (s.hours ?? HOURS) * 3600) {
    t += DT;
    vi.setSystemTime(t * 1000);
    game.tick(DT);
    for (let c = 0; c < s.cps * DT; c++) game.clickToken();
    if (!game.careerModifiers.autoBuyUnits) buyGreedy(game);
    else if (t - lastAutoBuy >= 1) {
      lastAutoBuy = t;
      runAutoBuy(game, { units: true, upgrades: true });
    }

    if (t >= nextBooster) {
      const id = pickWeightedBoosterId(Math.random, game.careerModifiers);
      const def = BOOSTER_DEFINITIONS.find((d) => d.id === id)!;
      if (def.kind === "instant") {
        // The claim flushes a save first; the server then credits the grant.
        save();
        const grant = getWindfallGrant(
          game.unitStates.map((u) => ({ unitId: u.id, owned: u.owned })),
          game.phdCount,
          game.careerModifiers
        );
        game.applyWindfall(grant);
        prev = {
          ...prev!,
          tokens: prev!.tokens + grant,
          totalTokensEarned: prev!.totalTokensEarned + grant
        };
      } else {
        game.grantBooster(id, def.durationSecs * game.boosterDurationMultiplier * 1000);
      }
      nextBooster =
        t + (BOOSTER_SPAWN_MIN_SECS + BOOSTER_SPAWN_MAX_SECS) / 2 / game.boosterSpawnMultiplier;
    }

    // An upgrader spin: flushed first, settled by the server on the stored
    // save (phdCount, upgraderNet, the spin counter), then adopted.
    if (spinEvery > 0 && t - lastSpin >= spinEvery && game.phdCount >= 10) {
      lastSpin = t;
      save();
      const stake = Math.floor(game.phdCount / 10);
      const outcome = settleSpin(stake, 200, game.phdCount, Math.floor(Math.random() * 1e6));
      if (outcome) {
        prev = {
          ...prev!,
          phdCount: outcome.phdCount,
          upgraderNet: prev!.upgraderNet + (outcome.phdCount - game.phdCount)
        };
        game.applySpinResult(outcome.phdCount, ++seq);
        if (outcome.consolation) {
          game.grantBooster(outcome.consolation.boosterId, outcome.consolation.remainingMs);
        }
      }
    }

    const run = game.runSeconds;
    if (run >= minRunSecs && game.canPrestige) {
      const rate = game.phdGain / run;
      if (rate > bestRate) bestRate = rate;
      if (rate < bestRate * 0.97 || run >= 6 * 3600) {
        game.prestige();
        bestRate = 0;
        save(true);
        // Bought in the window, each after a flush, settled by the server on
        // the stored save.
        invest(
          game,
          s.investShare ?? 0.5,
          () => save(),
          () => {
            prev = { ...prev!, phdCount: game.phdCount, phdInvested: game.phdInvested };
            for (const id of game.careerNodeIds) if (!order.includes(id)) order.push(id);
            nodes = game.careerNodeIds.length;
          }
        );
        game.closeCareerWindowLocal();
      }
    }
    if (s.autosaveSecs > 0 && t - prevAt >= s.autosaveSecs) save();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
  return { pairs, order };
}

function sampleEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  if (n === 1) return [items[Math.floor(items.length / 2)]!];
  const at = (i: number) => Math.round((i * (items.length - 1)) / (n - 1));
  return Array.from({ length: n }, (_, i) => items[at(i)]!);
}

describe.skipIf(!RUN)("save cadence simulation", () => {
  it("writes the honest save intervals the API replays", () => {
    const pairs: Pair[] = [];
    let purchaseOrder: string[] = [];
    for (const scenario of SCENARIOS) {
      const { pairs: all, order } = play(scenario);
      // Every scenario buys cheapest first from the same catalog, so one order covers all.
      expect(order.slice(0, purchaseOrder.length)).toEqual(
        purchaseOrder.slice(0, order.length)
      );
      if (order.length > purchaseOrder.length) purchaseOrder = order;
      if (FULL_OUT) {
        pairs.push(...all);
        continue;
      }
      // From the hours the tree makes runs fast enough to fit between saves.
      // Whole runs between two saves first (the hard case), then other prestiges.
      const late = all.filter((p) => p.hours >= 3);
      const whole = late.filter((p) => p.wholeRun);
      const wholeTaken = sampleEvenly(whole, Math.ceil((scenario.prestiged * 3) / 4));
      const others = late.filter((p) => p.prestiged && !p.wholeRun);
      pairs.push(...wholeTaken);
      pairs.push(...sampleEvenly(others, scenario.prestiged - wholeTaken.length));
      pairs.push(...sampleEvenly(late.filter((p) => !p.prestiged), scenario.plain));
    }
    expect(pairs.every((p) => p !== undefined && p !== null)).toBe(true);
    writeFileSync(OUT, JSON.stringify({ purchaseOrder, pairs }) + "\n");
    expect(pairs.length).toBeGreaterThan(50);
  }, 3_600_000);
});
