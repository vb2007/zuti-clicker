<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick, useId } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title?: string;
    ariaLabel?: string;
    role?: "dialog" | "alertdialog";
    dismissOnBackdrop?: boolean;
    maxWidth?: number | string;
    zIndex?: number;
    centerContent?: boolean;
    // Tighter padding, for a dense modal on a phone (see UpgraderModal.vue).
    compact?: boolean;
  }>(),
  {
    title: undefined,
    ariaLabel: undefined,
    role: "dialog",
    dismissOnBackdrop: true,
    maxWidth: 420,
    zIndex: 1000,
    centerContent: false,
    compact: false
  }
);

const emit = defineEmits<{ close: [] }>();

const titleId = useId();
const modalRef = ref<HTMLElement | null>(null);

const maxWidthStyle = typeof props.maxWidth === "number" ? `${props.maxWidth}px` : props.maxWidth;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(): HTMLElement[] {
  const el = modalRef.value;
  if (!el) return [];
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

function trapFocus(e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const focusables = getFocusable();
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
    return;
  }
  trapFocus(e);
}

function onBackdropClick() {
  if (props.dismissOnBackdrop) emit("close");
}

// Body scroll lock, shared across every BaseModal instance via a module-level
// counter — html/body/#app already carry `overflow: hidden` globally (see
// base.css), so this is mostly a defensive no-op today, but keeps behaving
// correctly once a scrollable mobile sheet exists and if two modals ever
// stack (an inline lock/unlock pair here would clobber each other's restore).
let previouslyFocused: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      window.addEventListener("keydown", onKeydown);
      lockScroll();
      await nextTick();
      const focusables = getFocusable();
      (focusables[0] ?? modalRef.value)?.focus();
    } else {
      window.removeEventListener("keydown", onKeydown);
      unlockScroll();
      previouslyFocused?.focus();
      previouslyFocused = null;
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
  if (props.open) unlockScroll();
});
</script>

<script lang="ts">
let scrollLockCount = 0;
let previousBodyOverflow = "";

function lockScroll() {
  if (scrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount++;
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="base-modal-backdrop"
      :style="{ zIndex }"
      @click.self="onBackdropClick"
    >
      <div
        ref="modalRef"
        class="base-modal"
        :class="{ 'center-content': centerContent, compact }"
        :style="{ maxWidth: maxWidthStyle }"
        :role="role"
        aria-modal="true"
        :aria-label="title ? undefined : ariaLabel"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
      >
        <h2 v-if="title" :id="titleId" class="modal-title">{{ title }}</h2>
        <slot />
        <slot name="actions" />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.base-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 180ms ease;
}

.base-modal {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 28px 32px 24px;
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  animation: fadeScaleIn 200ms ease;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.modal-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  margin-bottom: 18px;
}

.base-modal.center-content {
  text-align: center;
}

.base-modal.compact {
  padding: 18px 16px 16px;
}
.base-modal.compact .modal-title {
  margin-bottom: 12px;
}
</style>
