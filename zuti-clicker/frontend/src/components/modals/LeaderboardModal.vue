<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useUiStore } from "@/stores/uiStore";
import { useLeaderboardStore } from "@/stores/leaderboardStore";
import { useAuthStore } from "@/stores/authStore";
import { formatNumber, formatTime } from "@/utils/formatters";
import type { LeaderboardMetric } from "@/types";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();
const ui = useUiStore();
const leaderboard = useLeaderboardStore();
const auth = useAuthStore();

const METRICS: LeaderboardMetric[] = ["tokens", "clicks", "phd", "playtime"];

const metricLabels: Record<LeaderboardMetric, () => string> = {
  tokens: () => t("leaderboard.metricTokens"),
  clicks: () => t("leaderboard.metricClicks"),
  phd: () => t("leaderboard.metricPhd"),
  playtime: () => t("leaderboard.metricPlaytime")
};

function formatValue(value: number, metric: LeaderboardMetric): string {
  return metric === "playtime" ? formatTime(value) : formatNumber(value);
}

// The viewer only needs a separate pinned row when their rank isn't already
// among the returned entries (either outside the top-N slice, or excluded
// entirely because they're opted out).
const viewerShownSeparately = computed(() => {
  const v = leaderboard.viewer;
  if (!v) return false;
  return !leaderboard.entries.some((e) => e.rank === v.rank);
});

function selectMetric(metric: LeaderboardMetric) {
  void leaderboard.fetch(metric);
}

watch(
  () => ui.leaderboardModalOpen,
  (open) => {
    if (open) void leaderboard.fetch(leaderboard.metric);
  }
);

function close() {
  ui.leaderboardModalOpen = false;
}
</script>

<template>
  <BaseModal
    :open="ui.leaderboardModalOpen"
    :title="t('leaderboard.title')"
    :max-width="420"
    :z-index="1000"
    closable
    @close="close"
  >
    <div class="seg-group" role="group">
      <button
        v-for="m in METRICS"
        :key="m"
        class="seg-btn"
        :class="{ active: leaderboard.metric === m }"
        :aria-pressed="leaderboard.metric === m"
        @click="selectMetric(m)"
      >
        {{ metricLabels[m]() }}
      </button>
    </div>

    <div class="board">
      <div v-if="leaderboard.loading" class="board-status">…</div>
      <div v-else-if="leaderboard.error" class="board-status">{{ t("leaderboard.loadError") }}</div>
      <div v-else-if="leaderboard.entries.length === 0" class="board-status">
        {{ t("leaderboard.empty") }}
      </div>
      <template v-else>
        <div class="board-header">
          <span class="col-rank">{{ t("leaderboard.rank") }}</span>
          <span class="col-player">{{ t("leaderboard.player") }}</span>
          <span class="col-value">{{ t("leaderboard.value") }}</span>
        </div>
        <div
          v-for="entry in leaderboard.entries"
          :key="entry.rank"
          class="board-row"
          :class="{ self: entry.username === auth.user?.username }"
        >
          <span class="col-rank">{{ entry.rank }}</span>
          <span class="col-player">{{ entry.username }}</span>
          <span class="col-value">{{ formatValue(entry.value, leaderboard.metric) }}</span>
        </div>
      </template>

      <div v-if="viewerShownSeparately && leaderboard.viewer" class="board-row self pinned">
        <span class="col-rank">{{ leaderboard.viewer.rank }}</span>
        <span class="col-player">{{ t("leaderboard.yourRank") }}</span>
        <span class="col-value">{{ formatValue(leaderboard.viewer.value, leaderboard.metric) }}</span>
      </div>
      <div v-if="leaderboard.viewer?.hidden" class="hidden-note">
        {{ t("leaderboard.hiddenNote") }}
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.seg-group {
  display: flex;
  flex-wrap: wrap; /* four metrics don't fit one row on a 320px phone (or in Hungarian) */
  gap: 4px;
  margin-bottom: 16px;
}

.seg-btn {
  flex: 1 1 auto;
  padding: 6px 10px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  transition: all var(--transition-fast);
}
@media (hover: hover) {
  .seg-btn:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
}
@media (pointer: coarse), (max-width: 759px) {
  .seg-btn {
    min-height: 44px;
  }
}
/* A 3+1 wrap looks accidental — on the narrowest phones lay the four metrics out as 2×2. */
@media (max-width: 360px) {
  .seg-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
}
.seg-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.board {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.board-status {
  padding: 24px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.board-header {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 10px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--text-muted);
}

.board-row {
  display: grid;
  grid-template-columns: 40px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  transition: background var(--transition-fast);
}
.board-row:hover {
  background: var(--bg-elevated);
}
.board-row.self {
  background: var(--bg-elevated);
  color: var(--accent-text);
  font-weight: 700;
}
.board-row.pinned {
  margin-top: 6px;
  border-top: 1px dashed var(--border);
  padding-top: 12px;
  border-radius: 0;
}

.col-rank {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.col-player {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.col-value {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

.hidden-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
</style>
