import { describe, it, expect, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useGameStore } from "@/stores/gameStore";
import { CAREER_NODES, CAREER_NODES_BY_ID, careerBuyRefusal } from "@/utils/careerCore";
import { getWindfallGrant } from "@/utils/careerEconomy";
import { pickWeightedBoosterId } from "@/utils/upgrades";
import {
  UNIT_DEFINITIONS,
  UPGRADE_DEFINITIONS,
  BOOSTER_DEFINITIONS,
  BOOSTER_SPAWN_MIN_SECS,
  BOOSTER_SPAWN_MAX_SECS
} from "@/utils/gameConstants";

// The Academic Career balance simulation — the empirical check behind the
// catalog's prices (CLAUDE.md: verify balance with a simulated run, not just
// the formula tests). Skipped by default; run with `pnpm sim:balance`
// (BALANCE_SIM=1). It drives the REAL game store, so every formula, cap and
// node effect is exactly the shipped one.
//
// The modelled player is deliberately efficient (the target is "maxing the
// tree takes at least 100 h even for an efficient player"):
//   - clicks 3/s while active, buys the best-value unit greedily and every
//     upgrade once it's cheap relative to the next unit;
//   - claims every booster at the average spawn rate;
//   - prestiges when PhDs per hour of the run peak (never before 10 min, a
//     realistic minimum, and never past 6 h);
//   - at each purchase window invests up to INVEST_SHARE of its held PhDs,
//     cheapest available node first — so it keeps real PhDs (and their
//     multiplier) instead of dumping everything.
const RUN = process.env["BALANCE_SIM"] === "1";
const DT = 2; // simulated seconds per step
const CPS = 3;
const MIN_RUN_SECS = 600;
const MAX_RUN_SECS = 6 * 3600;
const MAX_HOURS = Number(process.env["SIM_HOURS"] ?? 300);
// SIM_INVEST=0 models a pure hoarder (never invests) for comparison.
const INVEST_SHARE = Number(process.env["SIM_INVEST"] ?? 0.5);
// SIM_ORDER=value buys the nodes that compound fastest first (PhD gain, then
// production), cheapest first within each; the default is cheapest first.
const VALUE_ORDER = process.env["SIM_ORDER"] === "value";
const VALUE_RANK: Record<string, number> = {
  phdGainPct: 0,
  phdProductionBonusAdd: 1,
  productionMult: 2,
  unitProductionMult: 3,
  productionPct: 4
};
// Seeded, so a run is reproducible (SIM_SEED, default 1). mulberry32.
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

function buyGreedy(game: ReturnType<typeof useGameStore>) {
  for (let guard = 0; guard < 200; guard++) {
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

function invest(game: ReturnType<typeof useGameStore>) {
  const budgetFloor = Math.floor(game.phdCount * (1 - INVEST_SHARE));
  for (;;) {
    const next = CAREER_NODES.filter(
      (n) => careerBuyRefusal(n.id, game.careerNodeIds, game.phdCount - budgetFloor) === null
    ).sort((a, b) =>
      VALUE_ORDER
        ? (VALUE_RANK[a.kind] ?? 9) - (VALUE_RANK[b.kind] ?? 9) || a.cost - b.cost
        : a.cost - b.cost
    )[0];
    if (!next || !game.buyCareerNodeLocal(next.id)) return;
  }
}

describe.skipIf(!RUN)("Academic Career balance simulation", () => {
  it("prints the progression of an efficient player", () => {
    // Simulated time drives the clock too: boosters expire and momentum
    // drains by Date.now(), and hundreds of simulated hours pass in seconds.
    vi.useFakeTimers({ now: 0 });
    vi.spyOn(Math, "random").mockImplementation(seededRandom(Number(process.env["SIM_SEED"] ?? 1)));
    setActivePinia(createPinia());
    const game = useGameStore();
    const total = CAREER_NODES.reduce((s, n) => s + n.cost, 0);
    let t = 0;
    let nextBooster = (BOOSTER_SPAWN_MIN_SECS + BOOSTER_SPAWN_MAX_SECS) / 2;
    let bestRate = 0;
    let prestiges = 0;
    let maxedAt: number | null = null;
    const log: string[] = [];
    const milestones = new Map<number, number>(); // hour -> nodes
    let nodesAtLastWindow = 0;
    let dryWindows = 0;

    while (t < MAX_HOURS * 3600) {
      t += DT;
      vi.setSystemTime(t * 1000);
      game.tick(DT);
      for (let c = 0; c < CPS * DT; c++) game.clickToken();
      buyGreedy(game);

      if (t >= nextBooster) {
        const id = pickWeightedBoosterId(Math.random, game.careerModifiers);
        const def = BOOSTER_DEFINITIONS.find((d) => d.id === id)!;
        if (def.kind === "instant") {
          game.applyWindfall(
            getWindfallGrant(
              game.unitStates.map((u) => ({ unitId: u.id, owned: u.owned })),
              game.phdCount,
              game.careerModifiers
            )
          );
        } else {
          game.grantBooster(id, def.durationSecs * game.boosterDurationMultiplier * 1000);
        }
        nextBooster =
          t + (BOOSTER_SPAWN_MIN_SECS + BOOSTER_SPAWN_MAX_SECS) / 2 / game.boosterSpawnMultiplier;
      }

      const run = game.runSeconds;
      if (run >= MIN_RUN_SECS && run % 60 < DT) {
        const rate = game.phdGain / run;
        if (rate > bestRate) bestRate = rate;
        const decaying = rate < bestRate * 0.97;
        if (game.canPrestige && (decaying || run >= MAX_RUN_SECS)) {
          const gained = game.prestige();
          prestiges++;
          bestRate = 0;
          invest(game);
          game.closeCareerWindowLocal();
          const owned = game.careerNodes.length;
          if (owned === nodesAtLastWindow) dryWindows++;
          nodesAtLastWindow = owned;
          if (prestiges <= 6 || prestiges % 40 === 0) {
            log.push(
              `#${prestiges} ${(t / 3600).toFixed(1)}h run ${(run / 60).toFixed(0)}m +${gained} held ${game.phdCount} invested ${game.phdInvested} nodes ${owned}`
            );
          }
          const hour = Math.floor(t / 3600);
          for (const h of [1, 3, 5, 10, 20, 40, 60, 80, 100, 125, 150, 200, 250, 300, 400]) {
            if (hour >= h && !milestones.has(h)) {
              milestones.set(h, owned);
              log.push(`  @${h}h: nodes ${owned}, held ${game.phdCount}, total ${game.phdTotal}, run ${(run / 60).toFixed(0)}m`);
            }
          }
          if (owned === CAREER_NODES.length && INVEST_SHARE > 0 && maxedAt === null) {
            maxedAt = t;
            // SIM_PAST_MAX=1 keeps playing, to watch how PhD totals grow afterwards.
            if (process.env["SIM_PAST_MAX"] !== "1") break;
          }
        }
      }
    }

    console.log(log.join("\n"));
    console.log("nodes owned at hour:", Object.fromEntries(milestones));
    console.log(
      `total tree cost ${total} PhD; prestiges ${prestiges}; windows with nothing new ${dryWindows}; ` +
        `maxed at ${maxedAt === null ? "never (within " + MAX_HOURS + " h)" : (maxedAt / 3600).toFixed(1) + " h"}`
    );
    console.log(
      "first-prestige price check:",
      CAREER_NODES_BY_ID.get("habilitation")!.cost
    );
    vi.useRealTimers();
    vi.restoreAllMocks();
    expect(prestiges).toBeGreaterThan(0);
  }, 3_600_000);
});
