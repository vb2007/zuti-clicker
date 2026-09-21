<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { usePrestige } from "@/composables/usePrestige";
import { formatNumber } from "@/utils/formatters";
import { PHD_TOKEN_SCALE, UNIT_REVEAL_FRACTION } from "@/utils/gameConstants";

const { t } = useI18n();
const game = useGameStore();
const { requestPrestige } = usePrestige();

// Same progressive-reveal idiom as the unit shop: once the player is close
// enough to matter, the mechanic becomes visible and stays visible.
const revealed = computed(
  () => game.totalTokensEarned >= PHD_TOKEN_SCALE * UNIT_REVEAL_FRACTION
);

// This is a progress-bar fraction, not a per-PhD rate — whole-percent
// rounding has no misleading-rate implication here.
const progressPercent = computed(() => Math.round(game.prestigeProgress * 100));

// game.canPrestige is exactly "phdGain >= 1" — see gameStore.ts.
const ready = computed(() => game.canPrestige);

// One progress bar, one label, driven by `ready` — see the template comment
// on why the label (and therefore what a 0% reset means) differs by state.
const progressLabel = computed(() =>
  ready.value
    ? t("prestige.progressToNextGain", { next: game.phdGain + 1 })
    : t("prestige.lockedProgress")
);
</script>

<template>
  <section v-if="revealed" class="prestige-panel">
    <div class="panel-header">
      <span class="panel-title">{{ t("prestige.title") }}</span>
    </div>

    <div class="panel-body">
      <div class="phd-row">
        <span class="phd-count">{{ formatNumber(game.phdCount) }}</span>
        <span class="phd-label">{{ t("prestige.phdOwned") }}</span>
      </div>

      <!-- The exact bonus percentages and the before/after preview live only
           in PrestigeConfirmModal.vue now — this panel just tracks progress
           toward the next PhD. -->
      <div class="progress-block">
        <div class="progress-label">
          <span>{{ progressLabel }}</span>
          <span class="progress-percent">{{ progressPercent }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ transform: `scaleX(${progressPercent / 100})` }" />
        </div>
        <span v-if="!ready" class="progress-caption">
          {{ t("prestige.tokensToNext", { amount: formatNumber(game.tokensToNextPhd) }) }}
        </span>
      </div>

      <button
        class="prestige-btn"
        :class="{ ready: game.canPrestige }"
        :disabled="!game.canPrestige"
        @click="requestPrestige"
      >
        <span>{{ t("prestige.button") }}</span>
        <!-- The pending gain used to be its own "+N PhD ready to defend"
             line above this button — moved onto the button itself so the
             number sits next to the action that grants it. Runs through
             formatNumber (never a bare toString): a late-game gain can be
             4-5+ digits, and the button must not overflow. -->
        <span v-if="ready" class="btn-gain">×{{ formatNumber(game.phdGain) }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.prestige-panel {
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
  animation: fadeScaleIn 220ms ease both;
}

.panel-header {
  padding: 14px 14px 8px;
}

.panel-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-muted);
}

.panel-body {
  padding: 0 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.phd-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.phd-count {
  font-size: 22px;
  font-weight: 800;
  color: var(--accent-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.5px;
}

.phd-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.6px;
}

.progress-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
}

.progress-percent {
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
  font-weight: 600;
}

.progress-caption {
  font-size: 10.5px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.progress-track {
  position: relative;
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  overflow: hidden;
}

.progress-fill {
  position: absolute;
  inset: 0;
  border-radius: var(--radius-full);
  background: var(--accent);
  transform-origin: left;
  transition: transform var(--transition-base);
}

.prestige-btn {
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  background: var(--btn-dis-bg);
  color: var(--btn-dis-text);
  font-size: 13px;
  font-weight: 700;
  transition: all var(--transition-fast);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: baseline;
  gap: 6px;
  line-height: 1.3;
}

.btn-gain {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.prestige-btn.ready {
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
  animation: breathe 3.5s ease-in-out infinite;
}

.prestige-btn.ready:hover {
  filter: brightness(1.08);
}

.prestige-btn:disabled {
  cursor: not-allowed;
}
</style>
