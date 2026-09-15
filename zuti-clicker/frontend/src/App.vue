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
import ToastHost from "@/components/layout/ToastHost.vue";
import PrestigeConfirmModal from "@/components/prestige/PrestigeConfirmModal.vue";
import PrestigeCeremony from "@/components/prestige/PrestigeCeremony.vue";
import MobileTabBar from "@/components/layout/MobileTabBar.vue";
import { useGameLoop } from "@/composables/useGameLoop";
import { useBreakpoint } from "@/composables/useBreakpoint";

const { t } = useI18n();
const auth = useAuthStore();
const save = useSaveStore();
const ui = useUiStore();
const game = useGameStore();
const settings = useSettingsStore();
const { isCompact } = useBreakpoint();

useGameLoop();

// If the sheet was left open and the viewport widens back past the compact
// breakpoint (e.g. rotating a tablet, or resizing a desktop window that had
// been narrowed), the rails return to their always-visible desktop position
// via CSS regardless of this flag — but leaving it set would reopen the
// sheet unexpectedly the next time the window narrows again.
watch(isCompact, (compact) => {
  if (!compact) ui.mobilePanel = "none";
});

async function onKeydown(e: KeyboardEvent) {
  if (!e.repeat && e.altKey && e.code === "KeyX") {
    await save.resetSave();
    await auth.logout();
  }

  if (e.key === "Escape" && ui.mobilePanel !== "none") ui.mobilePanel = "none";
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
   sheets over it, opened by MobileTabBar and closed by the scrim, Escape, or
   tapping the active tab again. The rail components themselves are never
   unmounted — only re-parented visually via this class — so their own
   mount-in animations (slideInLeft/Right) don't replay on every open. */
@media (max-width: 759px) {
  .game-layout {
    grid-template-columns: 1fr;
  }

  .game-layout .rail {
    position: fixed;
    left: 0;
    right: 0;
    top: var(--header-h-compact);
    bottom: var(--mobile-tabbar-h);
    z-index: 400;
    transform: translateY(100%);
    transition: transform var(--transition-base);
    animation: none; /* supersede the rail's own one-shot mount animation */
  }

  .game-layout.panel-stats-open .rail-stats,
  .game-layout.panel-units-open .rail-units {
    transform: translateY(0);
  }
}

@media (max-width: 759px) and (prefers-reduced-motion: reduce) {
  .game-layout .rail {
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
    inset: var(--header-h-compact) 0 var(--mobile-tabbar-h) 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 300;
    animation: fadeIn var(--transition-base);
  }
}
</style>
