<script setup lang="ts">
import { useToastStore } from "@/stores/toastStore";

const toast = useToastStore();
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" role="status" aria-live="polite">
      <TransitionGroup name="toast" tag="div" class="toast-stack">
        <div
          v-for="entry in toast.toasts"
          :key="entry.id"
          class="toast-item"
          :class="entry.kind"
        >
          <span class="toast-icon">{{
            entry.kind === "success" ? "✓" : entry.kind === "booster" ? "⚡" : "⚠"
          }}</span>
          <span class="toast-msg">{{ entry.message }}</span>
          <button class="toast-close" @click="toast.dismiss(entry.id)" aria-label="Dismiss">
            ✕
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: max(20px, var(--sai-right));
  bottom: max(20px, var(--sai-bottom));
  z-index: 1500;
  pointer-events: none;
  display: flex;
  justify-content: flex-end;
}

.toast-stack {
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
}

.toast-item {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 340px;
  padding: 12px 14px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
}

.toast-item.success { border-color: var(--success); }
.toast-item.error { border-color: var(--danger); }
.toast-item.booster { border-color: var(--booster); }

.toast-icon {
  font-size: 14px;
  flex-shrink: 0;
}
.toast-item.success .toast-icon { color: var(--success); }
.toast-item.error .toast-icon { color: var(--danger); }
.toast-item.booster .toast-icon { color: var(--booster); }

.toast-msg {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  flex: 1;
}

.toast-close {
  position: relative;
  flex-shrink: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px;
}
/* Visible glyph stays small; the tap target is padded out to 44px via a
   transparent ::before, same technique as UnitCard's info button. */
.toast-close::before {
  content: "";
  position: absolute;
  inset: -16px;
}
.toast-close:hover { color: var(--text-primary); }

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--transition-base),
    transform var(--transition-base);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}
.toast-leave-active {
  position: absolute;
}

@media (max-width: 759px) {
  .toast-host {
    left: max(16px, var(--sai-left));
    right: max(16px, var(--sai-right));
    justify-content: center;
    bottom: calc(var(--tabbar-total) + 16px);
  }
  .toast-item {
    max-width: 100%;
  }
}
</style>
