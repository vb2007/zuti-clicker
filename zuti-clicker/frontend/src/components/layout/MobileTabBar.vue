<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useUiStore } from "@/stores/uiStore";
import type { MobilePanel } from "@/stores/uiStore";

const { t } = useI18n();
const ui = useUiStore();

function toggle(panel: Exclude<MobilePanel, "none">) {
  ui.mobilePanel = ui.mobilePanel === panel ? "none" : panel;
}
</script>

<template>
  <nav class="mobile-tab-bar" :aria-label="t('nav.title')">
    <button
      class="tab-btn"
      :class="{ active: ui.mobilePanel === 'stats' }"
      :aria-expanded="ui.mobilePanel === 'stats'"
      aria-controls="mobile-sheet-stats"
      @click="toggle('stats')"
    >
      <span class="tab-icon" aria-hidden="true">📊</span>
      <span class="tab-label">{{ t("nav.stats") }}</span>
    </button>
    <button
      class="tab-btn"
      :class="{ active: ui.mobilePanel === 'units' }"
      :aria-expanded="ui.mobilePanel === 'units'"
      aria-controls="mobile-sheet-units"
      @click="toggle('units')"
    >
      <span class="tab-icon" aria-hidden="true">🛒</span>
      <span class="tab-label">{{ t("nav.shop") }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-tab-bar {
  display: none;
}

@media (max-width: 759px) {
  .mobile-tab-bar {
    display: flex;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    /* --tabbar-total includes the home-indicator inset. Under border-box the
       padding below eats into it, leaving exactly --mobile-tabbar-h of content
       height; the previous fixed 60px left only ~26px on an iPhone. */
    height: var(--tabbar-total);
    padding: 0 var(--sai-right) var(--sai-bottom) var(--sai-left);
    background: var(--bg-surface);
    border-top: 1px solid var(--border);
    z-index: 500;
  }
}

.tab-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 44px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  transition: color var(--transition-fast);
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.tab-btn.active {
  color: var(--accent-text);
}

.tab-icon {
  font-size: 18px;
  line-height: 1;
}
</style>
