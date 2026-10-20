<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSaveStore } from "@/stores/saveStore";
import BaseModal from "./BaseModal.vue";

// Shown when the server refused an account's first save — the progress made
// as a guest, before the account existed — as unverifiable. Saving is held
// until the player picks a way out (see saveStore.carryOverRejected), so it
// can't be dismissed: Escape, Back and the backdrop do nothing.
const { t } = useI18n();
const save = useSaveStore();

const busy = ref(false);

async function keepAsGuest() {
  if (busy.value) return;
  busy.value = true;
  try {
    await save.logout({ keepProgress: true });
  } finally {
    busy.value = false;
  }
}

async function startFresh() {
  if (busy.value) return;
  busy.value = true;
  try {
    await save.startAccountFresh();
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <BaseModal
    :open="save.carryOverRejected"
    role="alertdialog"
    :title="t('save.firstSaveRejected.title')"
    :max-width="400"
    :z-index="1100"
    :dismiss-on-backdrop="false"
    @close="() => {}"
  >
    <p class="modal-body">{{ t("save.firstSaveRejected.body") }}</p>
    <template #actions>
      <div class="modal-actions">
        <div class="choice">
          <button class="btn-primary" :disabled="busy" @click="keepAsGuest">
            {{ t("save.firstSaveRejected.keepBtn") }}
          </button>
          <p class="choice-note">{{ t("save.firstSaveRejected.keepNote") }}</p>
        </div>
        <div class="choice">
          <button class="btn-secondary" :disabled="busy" @click="startFresh">
            {{ t("save.firstSaveRejected.freshBtn") }}
          </button>
          <p class="choice-note">{{ t("save.firstSaveRejected.freshNote") }}</p>
        </div>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.modal-body {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 20px;
  text-wrap: pretty;
}

.modal-actions {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.choice {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.choice-note {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--text-muted);
  text-wrap: pretty;
}

.btn-primary,
.btn-secondary {
  width: 100%;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 700;
  transition:
    background var(--transition-fast),
    color var(--transition-fast);
}

.btn-primary {
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
}

.btn-secondary {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: progress;
}

@media (hover: hover) {
  .btn-primary:not(:disabled):hover { background: var(--accent-dim); }
  .btn-secondary:not(:disabled):hover { color: var(--text-primary); }
}

/* Touch / phone: 44px minimum targets. */
@media (max-width: 480px), (pointer: coarse) {
  .modal-actions button { min-height: 44px; }
}
</style>
