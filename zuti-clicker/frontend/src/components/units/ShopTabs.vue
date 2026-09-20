<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useUiStore } from "@/stores/uiStore";
import type { ShopTab } from "@/stores/uiStore";

const { t } = useI18n();
const ui = useUiStore();

const TABS: ShopTab[] = ["units", "upgrades"];
</script>

<template>
  <div class="shop-tabs" role="tablist">
    <button
      v-for="tab in TABS"
      :id="`shop-tab-${tab}`"
      :key="tab"
      class="shop-tab-btn"
      role="tab"
      :aria-selected="ui.shopTab === tab"
      :aria-controls="`shop-panel-${tab}`"
      :class="{ active: ui.shopTab === tab }"
      @click="ui.shopTab = tab"
    >
      {{ tab === "units" ? t("units.title") : t("upgrades.title") }}
    </button>
  </div>
</template>

<style scoped>
/* Same inset-track pattern as AuthModal's login/register tabs — the closest
   existing "tab", as opposed to the units/upgrades/leaderboard segmented
   *filters* (MultiplierSelector, SettingsModal, LeaderboardModal), which are
   a different pattern (equal-weight mutually exclusive views of the SAME
   data, not two different panels). */
.shop-tabs {
  display: flex;
  gap: 4px;
  margin: 10px 12px 0;
  padding: 4px;
  background: var(--bg-elevated);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}

.shop-tab-btn {
  flex: 1;
  padding: 7px 10px;
  border-radius: calc(var(--radius-sm) - 2px);
  font-size: 12px;
  font-weight: 700;
  background: transparent;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
}
.shop-tab-btn.active { background: var(--accent); color: #fff; }
.shop-tab-btn:not(.active):hover { color: var(--text-primary); }

@media (max-width: 759px) {
  .shop-tab-btn {
    min-height: 40px;
  }
}
</style>
