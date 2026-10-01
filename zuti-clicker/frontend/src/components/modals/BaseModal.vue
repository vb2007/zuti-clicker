<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick, useId } from "vue";
import { useI18n } from "vue-i18n";
import { useOverlay } from "@/composables/useOverlayStack";

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
    // Renders a ✕ in a header row that stays pinned while the body scrolls.
    // For content modals a player can simply walk away from; alert-style
    // modals that ask a question keep their explicit buttons instead.
    closable?: boolean;
  }>(),
  {
    title: undefined,
    ariaLabel: undefined,
    role: "dialog",
    dismissOnBackdrop: true,
    maxWidth: 420,
    zIndex: 1000,
    centerContent: false,
    compact: false,
    closable: false
  }
);

const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();

// Escape and the browser/Android Back button are routed through the shared
// overlay stack so only the top-most overlay reacts (see useOverlayStack.ts).
useOverlay(
  () => props.open,
  () => emit("close")
);

const titleId = useId();
const modalRef = ref<HTMLElement | null>(null);

const maxWidthStyle = computed(() =>
  typeof props.maxWidth === "number" ? `${props.maxWidth}px` : props.maxWidth
);

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
      // The ✕ is first in the DOM but is never the right initial focus —
      // that belongs on the content (a form field, the primary action).
      const focusables = getFocusable();
      const initial = focusables.find((el) => !el.hasAttribute("data-modal-close"));
      // preventScroll: focusing must not scroll a tall modal's first field up
      // under the sticky ✕ header — it opens at the top, always.
      (initial ?? focusables[0] ?? modalRef.value)?.focus({ preventScroll: true });
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
        :class="{ 'center-content': centerContent, compact, closable }"
        :style="{ maxWidth: maxWidthStyle }"
        :role="role"
        aria-modal="true"
        :aria-label="title ? undefined : ariaLabel"
        :aria-labelledby="title ? titleId : undefined"
        tabindex="-1"
      >
        <div v-if="title || closable" class="modal-head" :class="{ closable }">
          <h2 v-if="title" :id="titleId" class="modal-title">{{ title }}</h2>
          <button
            v-if="closable"
            type="button"
            class="modal-close"
            data-modal-close
            :aria-label="t('common.close')"
            @click="emit('close')"
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
  /* Gutters never shrink below the device's safe-area insets (notch, rounded
     corners, home indicator) — viewport-fit=cover lets the page reach them. */
  padding: max(20px, var(--sai-top)) max(20px, var(--sai-right)) max(20px, var(--sai-bottom))
    max(20px, var(--sai-left));
  animation: fadeIn 180ms ease;
}

.base-modal {
  /* Padding as variables so the sticky header (below) can bleed to the box's
     edges exactly, whatever variant (phone, compact) is active. */
  --modal-pad-x: 32px;
  --modal-pad-top: 28px;
  --modal-pad-bottom: 24px;

  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--modal-pad-top) var(--modal-pad-x) var(--modal-pad-bottom);
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  animation: fadeScaleIn 200ms ease;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}

.modal-title {
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  /* The head owns the spacing below the title. */
  margin: 0;
  /* Long titles wrap (Hungarian runs longer) instead of pushing the ✕ away. */
  min-width: 0;
  overflow-wrap: anywhere;
}

/* The ✕ row stays put while the body scrolls, so a modal taller than the
   screen can always be dismissed. A closable modal has no top padding of its
   own (the header supplies it — see .base-modal.closable below), so the
   header's natural position is the very top of the scrollport: sticking at
   top: 0 then moves nothing. It bleeds sideways over the padding and paints
   its own background so scrolled content passes cleanly underneath. */
.modal-head.closable {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0 calc(-1 * var(--modal-pad-x)) 8px;
  padding: 8px 12px 6px var(--modal-pad-x);
  background: var(--bg-surface);
}

.modal-close {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  margin-left: auto;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast);
}

@media (hover: hover) {
  .modal-close:hover {
    color: var(--text-primary);
    background: var(--bg-elevated);
  }
}

/* Touch: 44px is the minimum comfortable target. */
@media (pointer: coarse), (max-width: 759px) {
  .modal-close {
    width: 44px;
    height: 44px;
  }
}

.base-modal.center-content {
  text-align: center;
}

@media (max-width: 480px) {
  .base-modal-backdrop {
    padding: max(12px, var(--sai-top)) max(12px, var(--sai-right)) max(12px, var(--sai-bottom))
      max(12px, var(--sai-left));
  }
  .base-modal {
    --modal-pad-x: 18px;
    --modal-pad-top: 22px;
    --modal-pad-bottom: 18px;
  }
}

/* Phone landscape: every vertical pixel counts. */
@media (max-height: 500px) {
  .base-modal-backdrop {
    padding-top: max(8px, var(--sai-top));
    padding-bottom: max(8px, var(--sai-bottom));
  }
  .base-modal {
    --modal-pad-top: 16px;
    --modal-pad-bottom: 14px;
  }
  .modal-head {
    margin-bottom: 12px;
  }
}

/* Keyboard focus moving into a tall modal must not land under the sticky header. */
.base-modal.closable {
  scroll-padding-top: 64px;
}

.base-modal.compact {
  --modal-pad-x: 16px;
  --modal-pad-top: 18px;
  --modal-pad-bottom: 16px;
}
.base-modal.compact .modal-head {
  margin-bottom: 12px;
}
.base-modal.compact .modal-head.closable {
  margin-bottom: 8px;
}
/* Last so it beats every padding variant above. */
.base-modal.closable {
  --modal-pad-top: 0px;
}
</style>
