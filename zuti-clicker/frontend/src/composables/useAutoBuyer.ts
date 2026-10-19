import { onMounted, onUnmounted } from "vue";
import { useGameStore } from "@/stores/gameStore";
import { useAutoBuyStore } from "@/stores/autoBuyStore";
import { UNIT_DEFINITIONS, UPGRADE_DEFINITIONS } from "@/utils/gameConstants";

// How often the auto-buyers look for something to buy, and the most single
// purchases one look may make (so a big balance is spent over a few looks,
// visibly, rather than in one frame).
export const AUTO_BUY_INTERVAL_MS = 1000;
export const AUTO_BUY_MAX_PER_TICK = 25;

/**
 * One auto-buy pass — exported pure-ish (store in, purchases out) so it can be
 * tested without timers. Units: repeatedly buy the single revealed unit with
 * the best price per unit of production, while one is affordable. Upgrades:
 * the cheapest revealed, affordable, unowned upgrade, repeatedly. Goes
 * through the same buyUnit/buyUpgrade a click does, so every gate (restricted,
 * a pending spin or career change) applies; nothing at all happens while the
 * Academic Career purchase window is open.
 */
export function runAutoBuy(
  game: ReturnType<typeof useGameStore>,
  enabled: { units: boolean; upgrades: boolean }
): number {
  const mods = game.careerModifiers;
  if (game.careerWindowOpen || game.serverActionPending) return 0;
  let bought = 0;

  if (mods.autoBuyUpgrades && enabled.upgrades) {
    while (bought < AUTO_BUY_MAX_PER_TICK) {
      const next = UPGRADE_DEFINITIONS.filter(
        (d) => !game.isUpgradeOwned(d.id) && game.isUpgradeRevealed(d.id) && game.canAffordUpgrade(d.id)
      ).sort((a, b) => game.getUpgradeCost(a.id) - game.getUpgradeCost(b.id))[0];
      if (!next || !game.buyUpgrade(next.id)) break;
      bought++;
    }
  }

  if (mods.autoBuyUnits && enabled.units) {
    while (bought < AUTO_BUY_MAX_PER_TICK) {
      let best: string | null = null;
      let bestRatio = Infinity;
      for (const def of UNIT_DEFINITIONS) {
        if (!game.isUnitRevealed(def.id) || !game.canAfford(def.id, 1)) continue;
        const production = def.baseProduction * (mods.unitProductionMult[def.id] ?? 1);
        const ratio = game.getBuyCost(def.id, 1) / production;
        if (ratio < bestRatio) {
          bestRatio = ratio;
          best = def.id;
        }
      }
      if (best === null || !game.buyUnit(best, 1)) break;
      bought++;
    }
  }
  return bought;
}

/** Runs the auto-buyers on a timer while the app is mounted (see App.vue). */
export function useAutoBuyer(): void {
  const game = useGameStore();
  const autoBuy = useAutoBuyStore();
  let id: ReturnType<typeof setInterval> | null = null;
  onMounted(() => {
    id = setInterval(() => {
      runAutoBuy(game, { units: autoBuy.unitsEnabled, upgrades: autoBuy.upgradesEnabled });
    }, AUTO_BUY_INTERVAL_MS);
  });
  onUnmounted(() => {
    if (id !== null) clearInterval(id);
  });
}
