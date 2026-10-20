import { describe, it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { setActivePinia, createPinia } from "pinia";
import { useGameStore } from "@/stores/gameStore";
import { CAREER_NODES, careerBuyRefusal } from "@/utils/careerCore";
import { getWindfallGrant } from "@/utils/careerEconomy";
import { pickWeightedBoosterId } from "@/utils/upgrades";
import { runAutoBuy } from "@/composables/useAutoBuyer";
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
// before a windfall claim. The server's side is mirrored the way it really
// changes between saves: career purchases lower the stored PhDs, a windfall
// adds to the stored tokens.
//
// The player is the shape behind the 2026-10-20 incident: fast runs (a
// prestige as soon as the PhD rate peaks, from 10 s on), auto-buyers once the
// tree has them, half of every prestige's PhDs invested. Each scenario is
// sampled evenly over time — the prestige intervals (the hard case: a whole
// run between two saves) and a few plain ones as controls.
const RUN = process.env["SAVE_CADENCE_SIM"] === "1";
const OUT = "../api/src/tests/fixtures/honest-prestige-intervals.json";
const DT = 1;
const MIN_RUN_SECS = 10;
const HOURS = 80;
const SCENARIOS = [
  { source: "autosave30-cps3", autosaveSecs: 30, cps: 3, prestiged: 24, plain: 4 },
  { source: "autosaveOff-cps8", autosaveSecs: 0, cps: 8, prestiged: 24, plain: 1 },
  { source: "autosave30-cps8", autosaveSecs: 30, cps: 8, prestiged: 16, plain: 4 }
];

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

function invest(game: Game) {
  const keep = Math.floor(game.phdCount / 2);
  for (;;) {
    const next = CAREER_NODES.filter(
      (n) => careerBuyRefusal(n.id, game.careerNodeIds, game.phdCount - keep) === null
    ).sort((a, b) => a.cost - b.cost)[0];
    if (!next || !game.buyCareerNodeLocal(next.id)) return;
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
function play(s: (typeof SCENARIOS)[number]): { pairs: Pair[]; order: string[] } {
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
    prev = { ...incoming, upgraderNet: 0, phdInvested: game.phdInvested };
    prevAt = t;
    prevAfterPrestige = afterPrestige;
  };

  save();
  while (t < HOURS * 3600) {
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

    const run = game.runSeconds;
    if (run >= MIN_RUN_SECS && game.canPrestige) {
      const rate = game.phdGain / run;
      if (rate > bestRate) bestRate = rate;
      if (rate < bestRate * 0.97 || run >= 6 * 3600) {
        game.prestige();
        bestRate = 0;
        save(true);
        // Bought in the window, settled by the server on the stored save.
        invest(game);
        game.closeCareerWindowLocal();
        prev = { ...prev!, phdCount: game.phdCount, phdInvested: game.phdInvested };
        for (const id of game.careerNodeIds) if (!order.includes(id)) order.push(id);
        nodes = game.careerNodeIds.length;
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
  return Array.from({ length: n }, (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!);
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
