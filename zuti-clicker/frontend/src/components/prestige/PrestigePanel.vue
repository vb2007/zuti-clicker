<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { usePrestige } from "@/composables/usePrestige";
import { formatNumber, formatPercent } from "@/utils/formatters";
import { getProductionMultiplier, getCostMultiplier } from "@/utils/prestige";
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
// rounding has no misleading-rate implication here, unlike the multipliers
// below.
const progressPercent = computed(() => Math.round(game.prestigeProgress * 100));
// formatPercent (not Math.round): the cost discount steps by 0.5% per PhD, so
// rounding to a whole percent would make 1 PhD's true 0.5% look like 1%.
const productionPercent = computed(() => formatPercent((game.productionMultiplier - 1) * 100));
const costDiscountPercent = computed(() => formatPercent((1 - game.costMultiplier) * 100));

// game.canPrestige is exactly "phdGain >= 1" — see gameStore.ts. Below this
// point the panel previously showed nothing about the pending gain at all:
// the progress bar and button both read as "ready" with no number in sight
// until the confirm modal opened.
const ready = computed(() => game.canPrestige);

// Same before/after math PrestigeConfirmModal.vue already uses, applied one
// bracket ahead — what the player would have *after* confirming right now.
const newPhdCount = computed(() => game.phdCount + game.phdGain);
const afterProductionPercent = computed(() =>
  formatPercent((getProductionMultiplier(newPhdCount.value) - 1) * 100)
);
const afterCostPercent = computed(() =>
  formatPercent((1 - getCostMultiplier(newPhdCount.value)) * 100)
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

      <div v-if="game.phdCount > 0" class="multiplier-row">
        <span class="mult-chip">+{{ productionPercent }}% {{ t("prestige.production") }}</span>
        <span class="mult-chip">-{{ costDiscountPercent }}% {{ t("prestige.costDiscount") }}</span>
      </div>

      <!-- Not ready: same progress bar as before, now with a caption saying
           how many tokens are left instead of leaving the player to guess. -->
      <div v-if="!ready" class="progress-block">
        <div class="progress-label">
          <span>{{ t("prestige.lockedProgress") }}</span>
          <span class="progress-percent">{{ progressPercent }}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" :style="{ transform: `scaleX(${progressPercent / 100})` }" />
        </div>
        <span class="progress-caption">
          {{ t("prestige.tokensToNext", { amount: formatNumber(game.tokensToNextPhd) }) }}
        </span>
      </div>

      <!-- Ready: the headline number the panel used to hide entirely (only
           the confirm modal showed it). The bar relabels to "progress to
           +N" (rather than repeating "next PhD") because it resets to 0%
           the instant a PhD is banked — showing that against the OLD label
           would misleadingly look like nothing was gained. -->
      <div v-else class="ready-block">
        <span class="ready-headline">{{ t("prestige.unlockedHint", { gain: game.phdGain }) }}</span>
        <div class="progress-block">
          <div class="progress-label">
            <span>{{ t("prestige.progressToNextGain", { next: game.phdGain + 1 }) }}</span>
            <span class="progress-percent">{{ progressPercent }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ transform: `scaleX(${progressPercent / 100})` }" />
          </div>
        </div>
        <span class="after-line">
          {{ t("prestige.afterPrestige", { prod: afterProductionPercent, cost: afterCostPercent }) }}
        </span>
      </div>

      <button
        class="prestige-btn"
        :class="{ ready: game.canPrestige }"
        :disabled="!game.canPrestige"
        @click="requestPrestige"
      >
        {{ t("prestige.button") }}
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

.multiplier-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.mult-chip {
  padding: 3px 8px;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
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

.ready-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ready-headline {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-text);
}

.after-line {
  font-size: 10.5px;
  color: var(--text-secondary);
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
