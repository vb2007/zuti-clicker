import { describe, it, expect, beforeEach } from "vitest";
import { nextTick, defineComponent } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import { useGuestReminders, guestReminderMilestone } from "@/composables/useGuestReminders";
import { useAuthStore } from "@/stores/authStore";
import { useGameStore } from "@/stores/gameStore";
import { useToastStore } from "@/stores/toastStore";
import { useUiStore } from "@/stores/uiStore";
import { i18n } from "@/i18n";
import { PHD_TOKEN_SCALE } from "@/utils/gameConstants";

function mountReminders() {
  mount(defineComponent({ setup: () => (useGuestReminders(), () => null) }));
}

// phdGain = floor(sqrt(runTokensEarned / PHD_TOKEN_SCALE)) for a plain run.
async function reachGain(gain: number) {
  useGameStore().runTokensEarned = gain * gain * PHD_TOKEN_SCALE;
  await nextTick();
}

describe("guestReminderMilestone", () => {
  it("steps 1, 5, 25, 125 and stays put in between", () => {
    expect([0, 1, 4, 5, 24, 25, 124, 125, 600].map(guestReminderMilestone)).toEqual([
      0, 1, 1, 5, 5, 25, 25, 125, 125
    ]);
  });
});

describe("useGuestReminders", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useAuthStore().isChecked = true;
  });

  it("toasts a guest once per milestone, with a button that opens the login dialog", async () => {
    mountReminders();
    const toasts = useToastStore();

    await reachGain(1);
    expect(toasts.toasts).toHaveLength(1);
    const first = toasts.toasts[0]!;
    expect(first.kind).toBe("info");
    expect(first.message).toBe(i18n.global.t("guest.reminderPhd", { n: "1" }));
    expect(first.action?.label).toBe(i18n.global.t("guest.loginBtn"));

    await reachGain(2);
    await reachGain(4);
    expect(toasts.toasts).toHaveLength(1);

    await reachGain(5);
    expect(toasts.toasts).toHaveLength(2);

    first.action!.run();
    expect(useUiStore().authModalOpen).toBe(true);
  });

  it("never reminds a logged-in player, or before the session check", async () => {
    useAuthStore().user = { id: 1, username: "u", email: "u@example.com" };
    mountReminders();
    await reachGain(5);
    expect(useToastStore().toasts).toHaveLength(0);

    setActivePinia(createPinia());
    mountReminders();
    await reachGain(5);
    expect(useToastStore().toasts).toHaveLength(0);
  });

  it("a fresh game (a reset or logout) starts the milestones again", async () => {
    mountReminders();
    await reachGain(1);
    useGameStore().hardReset();
    await nextTick();
    await reachGain(1);
    expect(useToastStore().toasts).toHaveLength(2);
  });
});
