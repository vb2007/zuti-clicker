<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import BaseModal from "./BaseModal.vue";

const { t } = useI18n();
const auth = useAuthStore();
const ui = useUiStore();

const visible = computed(
  () => auth.isChecked && !auth.isLoggedIn && !ui.guestWarningDismissed
);

function openAuth() {
  ui.guestWarningDismissed = true;
  ui.authModalOpen = true;
}

function dismiss() {
  ui.guestWarningDismissed = true;
}
</script>

<template>
  <BaseModal
    :open="visible"
    role="alertdialog"
    :title="t('guest.warningTitle')"
    :max-width="400"
    :z-index="900"
    :dismiss-on-backdrop="false"
    center-content
    @close="dismiss"
  >
    <div class="modal-icon">💾</div>
    <p class="modal-body">{{ t("guest.warningBody") }}</p>
    <template #actions>
      <div class="modal-actions">
        <button class="btn-primary" @click="openAuth">{{ t("guest.loginBtn") }}</button>
        <button class="btn-ghost" @click="dismiss">{{ t("guest.continueBtn") }}</button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.modal-icon { font-size: 40px; margin-bottom: 14px; line-height: 1; }

.modal-body {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 24px;
}

.modal-actions { display: flex; flex-direction: column; gap: 8px; }

.btn-primary {
  padding: 10px 16px;
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 700;
  transition: background var(--transition-fast);
}
@media (hover: hover) {
  .btn-primary:hover { background: var(--accent-dim); }
}

.btn-ghost {
  padding: 8px 16px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  border-radius: var(--radius-sm);
  transition: color var(--transition-fast);
}
@media (hover: hover) {
  .btn-ghost:hover { color: var(--text-secondary); }
}
/* Touch / phone: 44px minimum targets (the ghost link included). */
@media (max-width: 480px), (pointer: coarse) {
  .modal-actions button { min-height: 44px; }
}
</style>
