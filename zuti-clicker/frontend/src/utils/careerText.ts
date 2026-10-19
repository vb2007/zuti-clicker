import { formatNumber } from "@/utils/formatters";
import type { CareerNode } from "@/utils/careerCore";

// A generic (key, params) => string shape, like utils/boosterEffectText.ts, so
// this stays framework-free and testable with any `t`.
type Translate = (key: string, params?: Record<string, unknown>) => string;

// Basis points as a percentage, up to two decimals, trailing zeros trimmed:
// 2500 -> "25", 25 -> "0.25", 3 -> "0.03". Never Math.round — several nodes
// step by fractions of a percent, and rounding would misstate them (the same
// rule formatPercent follows for the PhD discount).
export function formatBp(bp: number): string {
  if (!isFinite(bp)) return "0";
  return (bp / 100).toFixed(2).replace(/\.?0+$/, "");
}

// A multiplicative factor given in bp: 12500 -> "1.25", 15000 -> "1.5".
export function formatFactorBp(bp: number): string {
  if (!isFinite(bp)) return "1";
  return (bp / 10000).toFixed(4).replace(/\.?0+$/, "");
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function romanTier(tier: number): string {
  return ROMAN[tier - 1] ?? String(tier);
}

/** "Lab Access", or a track tier like "Grant Writing IV" ("Alpha Studies II" for unit tracks). */
export function careerNodeName(t: Translate, node: CareerNode): string {
  if (node.keystone) return t(`career.nodes.${node.id.split(".").pop()}.name`);
  const track = node.track!;
  const base = track.endsWith("Studies")
    ? t("career.tracks.unitStudies", { unit: t(`units.names.${node.target}`) })
    : t(`career.tracks.${track}`);
  return `${base} ${romanTier(node.tier)}`;
}

/** A keystone's flavour line ("" for track tiers, which need none). */
export function careerNodeFlavor(t: Translate, node: CareerNode): string {
  return node.keystone ? t(`career.nodes.${node.id.split(".").pop()}.desc`) : "";
}

/** What owning this one node does, in plain language. */
export function careerEffectText(t: Translate, node: CareerNode): string {
  const v = node.value;
  const p = (key: string, params: Record<string, unknown> = {}) => t(`career.effects.${key}`, params);
  switch (node.kind) {
    case "productionPct":
      return p("productionPct", { pct: formatBp(v) });
    case "productionMult":
      return p("productionMult", { mult: formatFactorBp(v) });
    case "unitProductionMult":
      return p("unitProductionMult", {
        mult: formatFactorBp(v),
        unit: t(`units.names.${node.target}`)
      });
    case "clickMult":
      return p("clickMult", { mult: formatFactorBp(v) });
    case "clickSynergyAdd":
      return p("clickSynergyAdd", { pct: formatBp(v) });
    case "critChanceAdd":
      return p("critChanceAdd", { pct: formatBp(v) });
    case "critMultAdd":
      return p("critMultAdd", { mult: formatFactorBp(v) });
    case "momentumMax":
      return p("momentumMax", { pct: formatBp(v) });
    case "unitCostDiscount":
      return p("unitCostDiscount", { pct: formatBp(v) });
    case "upgradeCostDiscount":
      return p("upgradeCostDiscount", { pct: formatBp(v) });
    case "startingTokens":
      return p("startingTokens", { amount: formatNumber(v) });
    case "keepUnitsPct":
      return p("keepUnitsPct", { pct: formatBp(v) });
    case "keepUpgradeFamily":
      return p("keepUpgradeFamily", { family: t(`career.families.${node.target}`) });
    case "boosterDurationPct":
      return p("boosterDurationPct", { pct: formatBp(v) });
    case "boosterSpawnPct":
      return p("boosterSpawnPct", { pct: formatBp(v) });
    case "boosterWindowPct":
      return p("boosterWindowPct", { pct: formatBp(v) });
    case "boosterPotencyPct":
      return p("boosterPotencyPct", {
        pct: formatBp(v),
        booster: t(`boosters.names.${node.target}`)
      });
    case "unlockBooster":
      return p("unlockBooster", { booster: t(`boosters.names.${node.target}`) });
    case "windfallSecs":
      return p("windfallSecs", { secs: v, booster: t("boosters.names.windfall") });
    case "phdGainPct":
      return p("phdGainPct", { pct: formatBp(v) });
    case "phdProductionBonusAdd":
      return p("phdProductionBonusAdd", { pct: formatBp(v) });
    case "phdCostCapAdd":
      return p("phdCostCapAdd", { pct: formatBp(v) });
    case "autoClickRate":
      return p("autoClickRate", { rate: (v / 100).toFixed(2).replace(/\.?0+$/, "") });
    case "autoBuyUnits":
      return p("autoBuyUnits");
    case "autoBuyUpgrades":
      return p("autoBuyUpgrades");
  }
}

// The kinds that shape a NEW run — they apply at the next prestige, never to
// the run in progress (see gameStore.prestige()).
const RUN_START_KINDS = new Set(["startingTokens", "keepUnitsPct", "keepUpgradeFamily"]);

export function appliesFromNextPrestige(node: CareerNode): boolean {
  return RUN_START_KINDS.has(node.kind);
}

// How a node reads on the canvas. "buyable" only ever exists while the
// purchase window is open; outside it an unlocked, unowned node is "available".
export type CareerNodeState = "owned" | "refundable" | "buyable" | "available" | "locked";

export function careerNodeState(
  node: CareerNode,
  owned: ReadonlyMap<string, { refundable: boolean }>,
  phdCount: number,
  windowOpen: boolean
): CareerNodeState {
  const mine = owned.get(node.id);
  if (mine) return mine.refundable ? "refundable" : "owned";
  if (node.parent !== null && !owned.has(node.parent)) return "locked";
  return windowOpen && phdCount >= node.cost ? "buyable" : "available";
}
