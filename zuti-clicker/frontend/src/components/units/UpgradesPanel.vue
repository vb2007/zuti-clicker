<script setup lang="ts">
import { computed, type ComputedRef } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { UPGRADE_DEFINITIONS } from "@/utils/gameConstants";
import { formatNumber, formatPercent } from "@/utils/formatters";
import {
  getFlatClickBonus,
  getClickMultiplier,
  getClickSynergy,
  getCritChance,
  getCritMultiplier,
  getBoosterDurationMultiplier,
  getBoosterSpawnMultiplier,
  getUpgradeEffectLabel,
  bestCritTier
} from "@/utils/upgrades";
import UpgradeTile from "./UpgradeTile.vue";
import type { UpgradeFamily } from "@/types";

const { t } = useI18n();
const game = useGameStore();

// Live aggregate per group — the actual number this group of purchases is
// currently contributing, not just a wall of names. Each formula already
// filters by family internally, so passing the whole ownedUpgrades list is
// correct and cheap; only the assembly (which parts to join, in what units)
// differs per group. Declared before FAMILY_GROUPS below so each group can
// carry its own aggregate directly (a ComputedRef, not a string key into a
// separate lookup table a 5th group could forget to extend).
const clickValueAggregate = computed(() => {
  const flat = getFlatClickBonus(game.ownedUpgrades);
  const mult = getClickMultiplier(game.ownedUpgrades);
  const parts: string[] = [];
  if (flat > 0) parts.push(`+${formatNumber(flat)}`);
  if (mult > 1) parts.push(`×${mult}`);
  return parts.join(" · ");
});
const synergyAggregate = computed(() =>
  t("upgrades.aggregateSynergy", { pct: formatPercent(getClickSynergy(game.ownedUpgrades) * 100) })
);
const critAggregate = computed(() =>
  t("upgrades.aggregateCrit", {
    pct: formatPercent(getCritChance(game.ownedUpgrades) * 100),
    mult: getCritMultiplier(game.ownedUpgrades)
  })
);
const boosterAggregate = computed(() => {
  const durationBonus = getBoosterDurationMultiplier(game.ownedUpgrades) - 1;
  const spawnBonus = getBoosterSpawnMultiplier(game.ownedUpgrades) - 1;
  const parts: string[] = [];
  if (durationBonus > 0) {
    parts.push(t("upgrades.aggregateBoosterDuration", { pct: formatPercent(durationBonus * 100) }));
  }
  if (spawnBonus > 0) {
    parts.push(t("upgrades.aggregateBoosterSpawn", { pct: formatPercent(spawnBonus * 100) }));
  }
  return parts.join(" · ");
});

// Display grouping is a UI-only concern (belongs here, not in
// gameConstants): flat and multiplier are two distinct formula families but
// both act on the same click value, so they read as one group to the
// player; boosterDuration/boosterSpawn are likewise two formulas that read
// as one "booster perks" section. Each group also carries a one-line
// plain-language subtitle — the reported confusion was "I don't know what
// category boosts clicks, what boosts passive income", so every group says
// up front what it actually touches.
const FAMILY_GROUPS: {
  key: string;
  families: UpgradeFamily[];
  labelKey: Parameters<typeof t>[0];
  descKey: Parameters<typeof t>[0];
  aggregate: ComputedRef<string>;
}[] = [
  {
    key: "clickValue",
    families: ["flat", "multiplier"],
    labelKey: "upgrades.familyClickValue",
    descKey: "upgrades.groupDescClickValue",
    aggregate: clickValueAggregate
  },
  {
    key: "synergy",
    families: ["synergy"],
    labelKey: "upgrades.familySynergy",
    descKey: "upgrades.groupDescSynergy",
    aggregate: synergyAggregate
  },
  {
    key: "crit",
    families: ["crit"],
    labelKey: "upgrades.familyCrit",
    descKey: "upgrades.groupDescCrit",
    aggregate: critAggregate
  },
  {
    key: "booster",
    families: ["boosterDuration", "boosterSpawn"],
    labelKey: "upgrades.familyBooster",
    descKey: "upgrades.groupDescBooster",
    aggregate: boosterAggregate
  }
];

// Only revealed, not-yet-owned upgrades appear in the buy grid — an owned
// one moves to the compact strip below instead of lingering in the grid at
// a permanently-disabled "owned" state (see the plan's UI section). Order
// preserves UPGRADE_DEFINITIONS' own ascending-cost order within a family.
const visibleGroups = computed(() =>
  FAMILY_GROUPS.map((group) => ({
    ...group,
    upgrades: UPGRADE_DEFINITIONS.filter(
      (d) =>
        group.families.includes(d.family) &&
        !game.isUpgradeOwned(d.id) &&
        game.isUpgradeRevealed(d.id)
    )
  })).filter((group) => group.upgrades.length > 0)
);

const ownedUpgradeDefs = computed(() => UPGRADE_DEFINITIONS.filter((d) => game.isUpgradeOwned(d.id)));
const totalCount = UPGRADE_DEFINITIONS.length;

// Only the highest-cost owned crit tier is actually in effect (see
// bestCritTier's own comment) — every other owned crit tier did nothing the
// moment a stronger one was bought. That's exactly "what have I bought and
// what's actually active", so it's marked rather than left silent.
const bestCritId = computed(() => bestCritTier(game.ownedUpgrades)?.id);

const ownedGroups = computed(() =>
  FAMILY_GROUPS.map((group) => ({
    ...group,
    defs: UPGRADE_DEFINITIONS.filter(
      (d) => group.families.includes(d.family) && game.isUpgradeOwned(d.id)
    ),
    aggregate: group.aggregate.value
  })).filter((group) => group.defs.length > 0)
);
</script>

<template>
  <div class="upgrades-panel">
    <div class="upgrades-summary">
      {{ t("upgrades.ownedCount", { owned: ownedUpgradeDefs.length, total: totalCount }) }}
    </div>

    <!-- The recurring confusion this answers directly: upgrades never touch
         passive income (tokens/sec) — only the click. -->
    <p class="click-only-note">{{ t("upgrades.clickOnlyNote") }}</p>

    <p v-if="visibleGroups.length === 0 && ownedUpgradeDefs.length === 0" class="upgrades-empty">
      {{ t("upgrades.emptyHint") }}
    </p>

    <section v-for="group in visibleGroups" :key="group.key" class="upgrade-group">
      <div class="group-header">
        <h3 class="group-title">{{ t(group.labelKey) }}</h3>
        <p class="group-desc">{{ t(group.descKey) }}</p>
      </div>
      <div class="upgrade-grid">
        <UpgradeTile v-for="d in group.upgrades" :key="d.id" :upgrade-id="d.id" />
      </div>
    </section>

    <section v-if="ownedGroups.length > 0" class="owned-strip">
      <h3 class="group-title">{{ t("upgrades.ownedTitle") }}</h3>

      <div v-for="group in ownedGroups" :key="group.key" class="owned-group">
        <div class="owned-group-header">
          <span class="owned-group-title">{{ t(group.labelKey) }}</span>
          <span class="owned-group-aggregate">{{ group.aggregate }}</span>
        </div>
        <div class="owned-chips">
          <span
            v-for="d in group.defs"
            :key="d.id"
            class="owned-chip"
            :class="{ superseded: d.family === 'crit' && d.id !== bestCritId }"
          >
            <span class="owned-chip-name">{{ t(`upgrades.names.${d.id}`) }}</span>
            <span class="owned-chip-effect">{{ getUpgradeEffectLabel(d) }}</span>
            <span v-if="d.family === 'crit' && d.id !== bestCritId" class="superseded-tag">
              {{ t("upgrades.superseded") }}
            </span>
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.upgrades-panel {
  padding: 10px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.upgrades-summary {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.click-only-note {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-top: -8px;
}

.upgrades-empty {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
}

.upgrade-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  animation: fadeScaleIn 220ms ease both;
}

.group-header {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.group-title {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.group-desc {
  font-size: 10.5px;
  color: var(--text-muted);
  line-height: 1.4;
}

.upgrade-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.owned-strip {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--border-subtle);
}

.owned-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.owned-group-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}

.owned-group-title {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.owned-group-aggregate {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent-text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.owned-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.owned-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  padding: 4px 9px;
}

.owned-chip-name {
  color: var(--text-muted);
}

.owned-chip-effect {
  color: var(--accent-text);
  font-variant-numeric: tabular-nums;
}

/* A superseded crit tier was bought but is not the one currently in
   effect (only the highest-cost owned tier applies — see bestCritTier).
   Dimmed rather than removed: it's still an honest record of the purchase. */
.owned-chip.superseded {
  opacity: 0.5;
}

.owned-chip.superseded .owned-chip-effect {
  color: var(--text-muted);
  text-decoration: line-through;
}

.superseded-tag {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

@media (max-width: 759px) {
  .upgrade-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}
</style>
