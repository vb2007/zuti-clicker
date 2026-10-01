<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { formatNumber, formatRate, formatTime } from "@/utils/formatters";
import StatItem from "./StatItem.vue";
import PrestigePanel from "@/components/prestige/PrestigePanel.vue";
import { useUiStore } from "@/stores/uiStore";
import { useBreakpoint } from "@/composables/useBreakpoint";

const { t } = useI18n();
const game = useGameStore();
const ui = useUiStore();
const { isCompact } = useBreakpoint();

const stats = computed(() => [
  {
    label: t("status.perSecond"),
    value: `${formatRate(game.tokensPerSecond)}/s`,
    primary: false,
    boosted: game.boosterProductionActive,
    badge: `×${game.boosterProductionMultiplier}`
  },
  {
    label: t("status.perClick"),
    value: `+${formatRate(game.tokensPerClick)}`,
    primary: false,
    boosted: game.boosterClickActive,
    badge: `×${game.boosterClickMultiplier}`
  },
  { label: t("status.totalEarned"), value: formatNumber(game.totalTokensEarned), primary: false },
  { label: t("status.totalClicks"), value: formatNumber(game.totalClicks), primary: false },
  { label: t("status.timePlayed"), value: formatTime(game.elapsedSeconds), primary: false },
  {
    label: t("status.phdCount"),
    value: formatNumber(game.phdCountDisplay),
    primary: game.phdCountDisplay > 0
  }
]);

const runStats = computed(() => [
  { label: t("status.runEarned"), value: formatNumber(game.runTokensEarned) },
  { label: t("status.runClicks"), value: formatNumber(game.runClicks) },
  { label: t("status.runTime"), value: formatTime(game.runSeconds) }
]);
</script>

<template>
  <aside class="status-col">
    <div class="col-header">
      <span class="col-title">{{ t("status.title") }}</span>
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

    <div class="token-hero">
      <div class="token-amount">{{ formatNumber(game.tokens) }}</div>
      <div class="token-label">{{ t("status.tokens") }}</div>
    </div>

    <div class="stats-list">
      <StatItem
        v-for="s in stats"
        :key="s.label"
        :label="s.label"
        :value="s.value"
        :primary="s.primary"
        :boosted="s.boosted"
        :badge="s.badge"
      />
    </div>

    <div class="run-section">
      <span class="run-title">{{ t("status.thisRun") }}</span>
      <div class="stats-list">
        <StatItem v-for="s in runStats" :key="s.label" :label="s.label" :value="s.value" />
      </div>
    </div>

    <PrestigePanel />
  </aside>
</template>

<style scoped>
.status-col {
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  transition:
    background var(--transition-slow),
    border-color var(--transition-slow);
  animation: slideInLeft 0.3s ease both;
}

.col-header {
  display: flex;
  align-items: center;
  padding: 16px 14px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.col-title {
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

.token-hero {
  padding: 20px 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.token-amount {
  font-size: 32px;
  font-weight: 900;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  letter-spacing: -1px;
  line-height: 1.1;
  /* No countUp animation here: a CSS `animation` plays once at element
     creation, but this element is created once at app boot (before any
     tokens are earned) and never remounts — the animation could never
     actually play in response to the token count changing. */
}

.token-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-top: 4px;
}

.stats-list {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.run-section {
  border-top: 1px solid var(--border-subtle);
  padding-top: 4px;
  flex-shrink: 0;
}

.run-title {
  display: block;
  padding: 10px 14px 0;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-muted);
}
</style>
