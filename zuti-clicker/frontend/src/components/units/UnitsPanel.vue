<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { UNIT_DEFINITIONS } from "@/utils/gameConstants";
import { useUiStore } from "@/stores/uiStore";
import { useGameStore } from "@/stores/gameStore";
import { formatPercent } from "@/utils/formatters";
import MultiplierSelector from "./MultiplierSelector.vue";
import UnitCard from "./UnitCard.vue";
import ShopTabs from "./ShopTabs.vue";
import UpgradesPanel from "./UpgradesPanel.vue";
import type { Multiplier } from "@/types";

const { t } = useI18n();
const ui = useUiStore();
const game = useGameStore();
const multiplier = ref<Multiplier>(1);

// The clearance booster only ever discounts UNIT costs (buyUpgrade/
// canAffordUpgrade use each upgrade's raw def.cost, never
// effectiveCostMultiplier) — so this chip is scoped to the Units tab only,
// never shown while Upgrades is active, to avoid implying a discount that
// doesn't apply there.
const unitPricesDiscounted = computed(
  () => ui.shopTab === "units" && game.boosterCostMultiplier < 1
);
const discountPercent = computed(() => formatPercent((1 - game.boosterCostMultiplier) * 100));
</script>

<template>
  <aside class="units-panel">
    <div class="panel-header">
      <span class="panel-title">{{ t("units.title") }}</span>
      <span v-if="unitPricesDiscounted" class="discount-chip">
        {{ t("units.pricesDiscounted", { pct: discountPercent }) }}
      </span>
    </div>

    <ShopTabs />

    <!-- The multiplier only applies to bulk unit purchases — upgrades are
         always a single one-time buy, so it's hidden on that tab rather
         than shown-but-inert. -->
    <MultiplierSelector v-if="ui.shopTab === 'units'" v-model="multiplier" />

    <div v-if="ui.shopTab === 'units'" class="units-list">
      <UnitCard
        v-for="unit in UNIT_DEFINITIONS"
        :key="unit.id"
        :unit-id="unit.id"
        :multiplier="multiplier"
      />
    </div>
    <div v-else class="units-list">
      <UpgradesPanel />
    </div>
  </aside>
</template>

<style scoped>
.units-panel {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-left: 1px solid var(--border);
  overflow: hidden;
  transition:
    background var(--transition-slow),
    border-color var(--transition-slow);
  animation: slideInRight 0.3s ease both;
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 14px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
}

.discount-chip {
  font-size: 10px;
  font-weight: 700;
  color: var(--booster);
  background: var(--booster-glow);
  border-radius: var(--radius-full);
  padding: 2px 8px;
}

.units-list {
  flex: 1;
  overflow-y: auto;
}
</style>
