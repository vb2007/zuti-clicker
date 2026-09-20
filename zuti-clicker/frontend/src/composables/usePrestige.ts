import { useGameStore } from "@/stores/gameStore";
import { useUiStore } from "@/stores/uiStore";
import { useSaveStore } from "@/stores/saveStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useAuthStore } from "@/stores/authStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";

/**
 * Wires the prestige flow's UI-facing actions to the underlying stores.
 * Kept separate from the components so the confirm -> ceremony -> sync
 * sequencing can be reasoned about (and tested) without mounting anything.
 */
export function usePrestige() {
  const game = useGameStore();
  const ui = useUiStore();
  const save = useSaveStore();
  const settings = useSettingsStore();
  const auth = useAuthStore();
  const antiCheat = useAntiCheatStore();

  function requestPrestige(): void {
    if (!game.canPrestige) return;
    ui.prestigeConfirmOpen = true;
  }

  function cancelPrestige(): void {
    ui.prestigeConfirmOpen = false;
  }

  /**
   * isTrusted-gated the same way UnitCard.vue's buy() is: a script clicking
   * this button earns nothing and is counted as an untrusted-click
   * detection signal (game.prestige() itself is also gated on
   * antiCheat.isRestricted once the account is actually restricted — this
   * is the automation-DETECTION half, not the sole enforcement).
   */
  function confirmPrestige(e: MouseEvent): void {
    if (!e.isTrusted) {
      antiCheat.recordClick(false);
      return;
    }
    const gained = game.prestige();
    ui.prestigeConfirmOpen = false;
    if (gained <= 0) return;
    ui.lastPrestigeGain = gained;
    ui.prestigeCeremonyOpen = settings.prestigeCeremony === "full";
    // Persist immediately rather than waiting for the next autosave tick (up
    // to 5 minutes away) — losing a fresh prestige to a refresh would be the
    // single worst moment for a sync gap to land on.
    if (auth.isLoggedIn) void save.sync();
  }

  function dismissCeremony(): void {
    ui.prestigeCeremonyOpen = false;
  }

  return { requestPrestige, cancelPrestige, confirmPrestige, dismissCeremony };
}
