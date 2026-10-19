import { formatPercent } from "@/utils/formatters";
import { emptyCareerModifiers, type CareerModifiers } from "@/utils/careerCore";
import { getBoosterEffectMultiplier } from "@/utils/careerEconomy";
import type { BoosterDefinition } from "@/types";

// A generic (key, params) => string shape rather than importing vue-i18n's
// own type here — this keeps utils/ framework-free like its neighbors
// (upgrades.ts, prestige.ts), while still being trivially satisfied by the
// real `t` from useI18n() at both call sites (ActiveBoostersBar.vue and
// useBoosters.ts's claim toast).
type Translate = (key: string, params?: Record<string, unknown>) => string;

// Turns a booster's kind + magnitude into the plain-language phrase players
// asked for ("Pop Quiz" boosts *what*, exactly?) — shared so the active-buff
// chip and the claim toast never drift out of sync with each other. Takes
// the already-resolved definition (rather than an id it would re-look-up
// itself) since both call sites already have one on hand; `undefined`
// covers a booster id that isn't in BOOSTER_DEFINITIONS (a client/server
// desync), returning "" for the caller to fall back on.
//
// `mods` (the Academic Career's potency nodes) makes the text show the
// booster's real, boosted strength — omitted, it is the plain base effect.
// One decimal for a multiplier (x7 at +10% potency is x7.6, not x8).
export function getBoosterEffectText(
  t: Translate,
  def: BoosterDefinition | undefined,
  mods: CareerModifiers = emptyCareerModifiers()
): string {
  if (!def) return "";
  const effective = getBoosterEffectMultiplier(def.id, mods);
  switch (def.kind) {
    case "production":
      return t("boosters.effect.production", { mult: formatPercent(effective) });
    case "click":
      return t("boosters.effect.click", { mult: formatPercent(effective) });
    case "costReduction":
      return t("boosters.effect.costReduction", { pct: formatPercent((1 - effective) * 100) });
    case "instant":
      return t("boosters.effect.instant");
    case "crit":
      return t("boosters.effect.crit", { pct: formatPercent(def.multiplier * 100) });
  }
}
