import { watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/authStore";
import { useGameStore } from "@/stores/gameStore";
import { useToastStore } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import { formatNumber } from "@/utils/formatters";

// The pending PhD gains a guest is reminded at: 1, 5, 25, 125, … Guests can't
// prestige (it needs an account), so each milestone is a nudge to log in or
// register with something concrete waiting — never a timer.
export const GUEST_REMINDER_FIRST = 1;
export const GUEST_REMINDER_FACTOR = 5;

/** The highest milestone at or below `gain`, or 0 below the first. */
export function guestReminderMilestone(gain: number): number {
  if (gain < GUEST_REMINDER_FIRST) return 0;
  let milestone = GUEST_REMINDER_FIRST;
  while (milestone * GUEST_REMINDER_FACTOR <= gain) milestone *= GUEST_REMINDER_FACTOR;
  return milestone;
}

/**
 * Toasts a guest each time their pending PhD gain first reaches a new
 * milestone, with a button that opens the login dialog. Mounted once, from
 * App.vue. Milestones already shown stay shown for this game: a fresh one
 * (a reset, a logout) starts them again.
 */
export function useGuestReminders(): void {
  const auth = useAuthStore();
  const game = useGameStore();
  const toast = useToastStore();
  const ui = useUiStore();
  const { t } = useI18n();

  let shown = 0;

  watch(
    () => game.resetEpoch,
    () => {
      shown = 0;
    }
  );

  watch(
    () => game.phdGain,
    (gain) => {
      if (!auth.isChecked || auth.isLoggedIn) return;
      const milestone = guestReminderMilestone(gain);
      if (milestone <= shown) return;
      shown = milestone;
      toast.push("info", t("guest.reminderPhd", { n: formatNumber(gain) }), {
        label: t("guest.loginBtn"),
        run: () => {
          ui.authModalOpen = true;
        }
      });
    }
  );
}
