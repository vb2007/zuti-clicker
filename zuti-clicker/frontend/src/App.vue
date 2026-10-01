<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { useSaveStore } from "@/stores/saveStore";
import { useUiStore } from "@/stores/uiStore";
import { useGameStore } from "@/stores/gameStore";
import { useSettingsStore } from "@/stores/settingsStore";
import AppHeader from "@/components/layout/AppHeader.vue";
import StatusColumn from "@/components/status/StatusColumn.vue";
import ClickerArea from "@/components/clicker/ClickerArea.vue";
import UnitsPanel from "@/components/units/UnitsPanel.vue";
import AuthModal from "@/components/modals/AuthModal.vue";
import GuestWarningModal from "@/components/modals/GuestWarningModal.vue";
import ConfirmModal from "@/components/modals/ConfirmModal.vue";
import SettingsModal from "@/components/modals/SettingsModal.vue";
import LeaderboardModal from "@/components/modals/LeaderboardModal.vue";
import UpgraderModal from "@/components/upgrader/UpgraderModal.vue";
import ToastHost from "@/components/layout/ToastHost.vue";
import PrestigeConfirmModal from "@/components/prestige/PrestigeConfirmModal.vue";
import PrestigeCeremony from "@/components/prestige/PrestigeCeremony.vue";
import MobileTabBar from "@/components/layout/MobileTabBar.vue";
import { useGameLoop } from "@/composables/useGameLoop";
import { useAntiCheat } from "@/composables/useAntiCheat";
import { useBreakpoint } from "@/composables/useBreakpoint";
import { useOverlay } from "@/composables/useOverlayStack";
import { QUICK_RESET_ENABLED, shouldQuickReset } from "@/utils/featureFlags";
import CheatWarningModal from "@/components/modals/CheatWarningModal.vue";

const { t } = useI18n();
const auth = useAuthStore();
const save = useSaveStore();
const ui = useUiStore();
const game = useGameStore();
const settings = useSettingsStore();
const { isCompact } = useBreakpoint();

useGameLoop();
useAntiCheat();

// If the sheet was left open and the viewport widens back past the compact
// breakpoint (e.g. rotating a tablet, or resizing a desktop window that had
// been narrowed), the rails return to their always-visible desktop position
// via CSS regardless of this flag — but leaving it set would reopen the
// sheet unexpectedly the next time the window narrows again.
watch(isCompact, (compact) => {
  if (!compact) ui.mobilePanel = "none";
});

// The open mobile sheet is an overlay like any modal: Escape and the browser/
// Android Back button close it, but only when nothing sits above it (modals
// register later, so they are always on top of it).
useOverlay(
  () => ui.mobilePanel !== "none",
  () => {
    ui.mobilePanel = "none";
  },
  400 // the sheet's z-index (see .rail below): under every modal (>= 900)
);

async function onKeydown(e: KeyboardEvent) {
  if (shouldQuickReset(e, QUICK_RESET_ENABLED)) {
    e.preventDefault();
    await save.resetSave();
    await auth.logout();
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

onMounted(async () => {
  await auth.checkSession();
});

watch(
  () => auth.isLoggedIn,
  async (loggedIn) => {
    if (loggedIn) {
      await Promise.all([save.load(), settings.loadFromServer()]);
    }
  }
);

// Widened beyond totalClicks so a pure idler (units doing all the work, zero
// manual clicks) still gets the unsaved-progress warning.
const hasProgress = computed(
  () => game.totalClicks > 0 || game.totalTokensEarned > 0 || game.phdCount > 0
);

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (hasProgress.value) {
    e.preventDefault();
    e.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", handleBeforeUnload));
onUnmounted(() => window.removeEventListener("beforeunload", handleBeforeUnload));

async function onConfirmDelete() {
  try {
    await save.resetSave();
  } catch {
    // A failed delete leaves local game state untouched and records the
    // failure in save.syncError (see saveStore), surfaced by the existing
    // sync-status indicator in the header — this catch only keeps the
    // confirm modal from getting stuck open on the rejection.
  } finally {
    ui.confirmDeleteOpen = false;
  }
}
</script>

<template>
  <div class="app">
    <AppHeader />
    <div
      class="game-layout"
      :class="{
        'panel-stats-open': ui.mobilePanel === 'stats',
        'panel-units-open': ui.mobilePanel === 'units'
      }"
    >
      <StatusColumn id="mobile-sheet-stats" class="rail rail-stats" />
      <ClickerArea class="clicker-col" />
      <UnitsPanel id="mobile-sheet-units" class="rail rail-units" />
    </div>

    <div
      v-if="ui.mobilePanel !== 'none'"
      class="mobile-scrim"
      @click="ui.mobilePanel = 'none'"
    ></div>

    <MobileTabBar />
  </div>

  <AuthModal />
  <GuestWarningModal />
  <SettingsModal />
  <LeaderboardModal />
  <UpgraderModal />
  <ConfirmModal
    v-if="ui.confirmDeleteOpen"
    :title="t('confirm.deleteSaveTitle')"
    :body="t('confirm.deleteSaveBody')"
    :confirm-label="t('confirm.deleteBtn')"
    :cancel-label="t('confirm.cancelBtn')"
    @confirm="onConfirmDelete"
    @cancel="ui.confirmDeleteOpen = false"
  />
  <PrestigeConfirmModal v-if="ui.prestigeConfirmOpen" />
  <PrestigeCeremony v-if="ui.prestigeCeremonyOpen" />
  <CheatWarningModal />
  <ToastHost />
</template>

<style scoped>
.app {
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.game-layout {
  display: grid;
  grid-template-columns: 252px 1fr 288px;
  flex: 1;
  overflow: hidden;
  position: relative;
  /* Landscape on a notched phone: keep the rails out from under the notch. */
  padding-left: var(--sai-left);
  padding-right: var(--sai-right);
}

/* Tablet / narrow desktop: keep the three-column shell, but the fixed rails
   would otherwise crush the clicker — narrow them instead of collapsing to
   the mobile layout outright. */
@media (max-width: 1119px) {
  .game-layout {
    grid-template-columns: clamp(200px, 18vw, 252px) 1fr clamp(232px, 20vw, 288px);
  }
}

/* Mobile: the clicker takes the full width; the two rails become slide-up
   sheets over it, opened by MobileTabBar and closed by their ✕, the scrim (the
   dimmed strip left above the sheet), Escape/Back, or tapping the active tab
   again. The rail components themselves are never
   unmounted — only re-parented visually via this class — so their own
   mount-in animations (slideInLeft/Right) don't replay on every open. */
@media (max-width: 759px) {
  .game-layout {
    --sheet-gap: 56px;
    /* A bare duration: --transition-base is "220ms ease" (duration AND easing), so it
       cannot sit in "visibility 0s linear <delay>" — a second easing function makes the
       whole declaration invalid and the slide-out silently loses its animation.
       Keep in sync with --transition-base's duration. */
    --sheet-ms: 220ms;
    grid-template-columns: 1fr;
  }

  .game-layout .rail {
    position: fixed;
    left: var(--sai-left);
    right: var(--sai-right);
    /* --sheet-gap leaves a strip of the scrim uncovered above the sheet: a
       sheet that exactly covered the scrim (as it used to) made "tap outside to
       close" impossible — the scrim was never reachable. */
    top: calc(var(--header-h-compact) + var(--sheet-gap));
    /* The bar's full footprint, home-indicator inset included. */
    bottom: var(--tabbar-total);
    z-index: 400;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.35);
    transform: translateY(100%);
    /* Closed = off-canvas AND hidden: without this the parked sheet's upward
       shadow spilled over the clicker area on every load, and its buttons stayed
       in the Tab order / accessibility tree. Visibility flips only once the
       slide-out has finished (hence the delay), and at once on opening. */
    visibility: hidden;
    transition:
      transform var(--sheet-ms) ease,
      visibility 0s linear var(--sheet-ms);
    animation: none; /* supersede the rail's own one-shot mount animation */
  }

  .game-layout.panel-stats-open .rail-stats,
  .game-layout.panel-units-open .rail-units {
    transform: translateY(0);
    visibility: visible;
    transition:
      transform var(--sheet-ms) ease,
      visibility 0s;
  }
}

/* Phone landscape has no height to spare: the sheet takes it all, and the ✕,
   Back/Escape and the tab button are the ways out. */
@media (max-width: 759px) and (max-height: 500px) {
  .game-layout {
    --sheet-gap: 0px;
  }
  .game-layout .rail {
    border-radius: 0;
    box-shadow: none;
  }
}

/* The open-state rule above is more specific than .rail, so it must be listed too or
   reduced-motion users still get the slide-in. */
@media (max-width: 759px) and (prefers-reduced-motion: reduce) {
  .game-layout .rail,
  .game-layout.panel-stats-open .rail-stats,
  .game-layout.panel-units-open .rail-units {
    transition: none;
  }
}

.mobile-scrim {
  display: none;
}

@media (max-width: 759px) {
  .mobile-scrim {
    display: block;
    position: fixed;
    inset: var(--header-h-compact) 0 var(--tabbar-total) 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 300;
    animation: fadeIn var(--transition-base);
  }
}
</style>
