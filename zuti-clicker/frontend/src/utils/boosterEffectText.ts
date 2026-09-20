import { BOOSTER_DEFINITIONS } from "@/utils/gameConstants";
import { formatPercent } from "@/utils/formatters";

// A generic (key, params) => string shape rather than importing vue-i18n's
// own type here — this keeps utils/ framework-free like its neighbors
// (upgrades.ts, prestige.ts), while still being trivially satisfied by the
// real `t` from useI18n() at both call sites (ActiveBoostersBar.vue and
// useBoosters.ts's claim toast).
type Translate = (key: string, params?: Record<string, unknown>) => string;

// Turns a booster's kind + magnitude into the plain-language phrase players
// asked for ("Pop Quiz" boosts *what*, exactly?) — shared so the active-buff
// chip and the claim toast never drift out of sync with each other.
export function getBoosterEffectText(t: Translate, boosterId: string): string {
  const def = BOOSTER_DEFINITIONS.find((d) => d.id === boosterId);
  if (!def) return "";
  switch (def.kind) {
    case "production":
      return t("boosters.effect.production", { mult: def.multiplier });
    case "click":
      return t("boosters.effect.click", { mult: def.multiplier });
    case "costReduction":
      return t("boosters.effect.costReduction", { pct: formatPercent(def.multiplier * 100) });
  }
}
