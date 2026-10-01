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
import { useBreakpoint } from "@/composables/useBreakpoint";

const { t } = useI18n();
const ui = useUiStore();
const { isCompact } = useBreakpoint();
const game = useGameStore();
const multiplier = ref<Multiplier>(1);

// The clearance booster only ever discounts UNIT costs (buyUpgrade/
// canAffordUpgrade use each upgrade's raw def.cost, never
// effectiveCostMultiplier) — so this chip is scoped to the Units tab only,
// never shown while Upgrades is active, to avoid implying a discount that
// doesn't apply there.
const unitPricesDiscounted = computed(
  () => ui.shopTab === "units" && game.boosterCostReductionActive
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
      <!-- Only on the mobile sheet (compact viewports): the rail is a slide-up
           sheet there, and the tab bar button was its only way out. -->
      <button
        v-if="isCompact"
        type="button"
        class="sheet-close"
        :aria-label="t('common.close')"
        @click="ui.mobilePanel = 'none'"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M3 3l10 10M13 3L3 13"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>

    <ShopTabs />

    <!-- The multiplier only applies to bulk unit purchases — upgrades are
         always a single one-time buy, so it's hidden on that tab rather
         than shown-but-inert. -->
    <MultiplierSelector v-if="ui.shopTab === 'units'" v-model="multiplier" />

    <div
      v-if="ui.shopTab === 'units'"
      id="shop-panel-units"
      class="units-list"
      role="tabpanel"
      aria-labelledby="shop-tab-units"
    >
      <UnitCard
        v-for="unit in UNIT_DEFINITIONS"
        :key="unit.id"
        :unit-id="unit.id"
        :multiplier="multiplier"
      />
    </div>
    <div
      v-else
      id="shop-panel-upgrades"
      class="units-list"
      role="tabpanel"
      aria-labelledby="shop-tab-upgrades"
    >
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

.sheet-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -12px -8px -12px auto; /* the 44px target without making the header taller */
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition: color var(--transition-fast);
}
@media (hover: hover) {
  .sheet-close:hover {
    color: var(--text-primary);
  }
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
