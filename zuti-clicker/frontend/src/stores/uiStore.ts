import { defineStore } from "pinia";
import { ref } from "vue";

// Which of the two mobile sheets (<760px) is currently slid over the
// clicker — "none" when both are closed. The bottom tab bar, the sheet
// itself, and its scrim all read this one flag so they can't disagree.
export type MobilePanel = "none" | "stats" | "units";

// Which tab of the right-hand shop rail (UnitsPanel) is active — shared by
// desktop and the mobile "Shop" sheet, which is the same component.
export type ShopTab = "units" | "upgrades";

export const useUiStore = defineStore("ui", () => {
  const authModalOpen = ref(false);
  const confirmDeleteOpen = ref(false);
  // Logging out couldn't save the latest progress first: "log out anyway?"
  const logoutUnsavedOpen = ref(false);
  const guestWarningDismissed = ref(false);
  const settingsModalOpen = ref(false);
  const leaderboardModalOpen = ref(false);
  const prestigeConfirmOpen = ref(false);
  const prestigeCeremonyOpen = ref(false);
  const upgraderOpen = ref(false);
  // The Academic Career opened to look at (view mode). Its purchase window
  // needs no flag here: it's shown whenever gameStore.careerWindowOpen is set.
  const careerOpen = ref(false);
  const lastPrestigeGain = ref(0);
  const mobilePanel = ref<MobilePanel>("none");
  const shopTab = ref<ShopTab>("units");

  return {
    authModalOpen,
    confirmDeleteOpen,
    logoutUnsavedOpen,
    guestWarningDismissed,
    settingsModalOpen,
    leaderboardModalOpen,
    prestigeConfirmOpen,
    prestigeCeremonyOpen,
    upgraderOpen,
    careerOpen,
    lastPrestigeGain,
    mobilePanel,
    shopTab
  };
});
