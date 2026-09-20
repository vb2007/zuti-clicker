<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { usePrestige } from "@/composables/usePrestige";
import { getPrestigeOutcome } from "@/utils/prestige";
import { formatPercent } from "@/utils/formatters";
import BaseModal from "@/components/modals/BaseModal.vue";

const { t } = useI18n();
const game = useGameStore();
const auth = useAuthStore();
const antiCheat = useAntiCheatStore();
const { cancelPrestige, confirmPrestige } = usePrestige();

// Reuse the same formulas gameStore uses for the "before" values, and the
// same getPrestigeOutcome PrestigePanel.vue uses for the "after" values,
// rather than re-deriving either, so a future balance tweak can't leave
// this preview silently out of sync with what prestige() actually applies.
const outcome = computed(() => getPrestigeOutcome(game.phdCount, game.phdGain));
const productionBefore = computed(() => `x${game.productionMultiplier.toFixed(2)}`);
const productionAfter = computed(() => `x${outcome.value.productionMultiplier.toFixed(2)}`);
// formatPercent (not Math.round): the cost discount steps by 0.5% per PhD, so
// rounding to a whole percent would make 1 PhD's true 0.5% look like 1%.
const costBefore = computed(() => `-${formatPercent((1 - game.costMultiplier) * 100)}%`);
const costAfter = computed(() => `-${formatPercent((1 - outcome.value.costMultiplier) * 100)}%`);
</script>

<template>
  <BaseModal
    :open="true"
    role="alertdialog"
    :title="t('confirm.prestigeTitle')"
    :max-width="400"
    :z-index="1100"
    @close="cancelPrestige"
  >
    <p class="gain-line">{{ t("confirm.prestigeGain", { gain: game.phdGain }) }}</p>

    <div class="mult-table">
      <div class="mult-row">
        <span class="mult-label">{{ t("prestige.production") }}</span>
        <span class="mult-value">{{ productionBefore }} → {{ productionAfter }}</span>
      </div>
      <div class="mult-row">
        <span class="mult-label">{{ t("prestige.costDiscount") }}</span>
        <span class="mult-value">{{ costBefore }} → {{ costAfter }}</span>
      </div>
    </div>

    <p class="modal-body">{{ t("confirm.prestigeLose") }}</p>

    <p v-if="!auth.isLoggedIn" class="guest-warning">
      {{ t("confirm.prestigeGuestWarning") }}
    </p>

    <template #actions>
      <div class="modal-actions">
        <button class="btn-cancel" @click="cancelPrestige">{{ t("confirm.cancelBtn") }}</button>
        <button
          class="btn-confirm"
          :disabled="antiCheat.isRestricted"
          @click="confirmPrestige($event)"
        >
          {{ t("confirm.prestigeConfirmBtn") }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.gain-line {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent-text);
  margin-bottom: 14px;
}

.mult-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  margin-bottom: 14px;
}

.mult-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.mult-label {
  color: var(--text-muted);
  font-weight: 500;
}

.mult-value {
  color: var(--text-primary);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.modal-body {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 14px;
}

.guest-warning {
  font-size: 12px;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  line-height: 1.5;
  margin-bottom: 20px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 8px 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  transition: all var(--transition-fast);
}
.btn-cancel:hover { border-color: var(--accent); color: var(--text-primary); }

.btn-confirm {
  padding: 8px 16px;
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 700;
  transition: filter var(--transition-fast);
}
.btn-confirm:hover:not(:disabled) { filter: brightness(1.1); }
.btn-confirm:disabled {
  background: var(--btn-dis-bg);
  color: var(--btn-dis-text);
  cursor: not-allowed;
}
</style>
