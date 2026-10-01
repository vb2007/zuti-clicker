<script setup lang="ts">
import BaseModal from "./BaseModal.vue";

defineProps<{
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <BaseModal
    :open="true"
    role="alertdialog"
    :title="title"
    :max-width="360"
    :z-index="1100"
    @close="emit('cancel')"
  >
    <p class="modal-body">{{ body }}</p>
    <template #actions>
      <div class="modal-actions">
        <button class="btn-cancel" @click="emit('cancel')">{{ cancelLabel }}</button>
        <button class="btn-confirm" @click="emit('confirm')">{{ confirmLabel }}</button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.modal-body {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 24px;
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
  transition:
    border-color var(--transition-fast),
    color var(--transition-fast);
}
@media (hover: hover) {
  .btn-cancel:hover { border-color: var(--accent); color: var(--text-primary); }
}

.btn-confirm {
  padding: 8px 16px;
  background: #ef4444;
  color: #fff;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 700;
  transition: background var(--transition-fast);
}
@media (hover: hover) {
  .btn-confirm:hover { background: #dc2626; }
}
/* Phone: the two actions stack, full width, so neither wraps its label (the
   Hungarian ones run long) and both are easy thumb targets. DOM order is kept
   (cancel first) so the visual and Tab orders agree. */
@media (max-width: 480px) {
  .modal-actions {
    flex-direction: column;
  }
  .modal-actions button {
    width: 100%;
  }
}
@media (max-width: 480px), (pointer: coarse) {
  .modal-actions button {
    min-height: 44px;
  }
}
</style>
