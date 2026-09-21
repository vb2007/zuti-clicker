import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import PrestigePanel from "@/components/prestige/PrestigePanel.vue";
import { useGameStore } from "@/stores/gameStore";
import { useUiStore } from "@/stores/uiStore";

describe("PrestigePanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("is hidden before the reveal threshold (10% of the PhD token scale)", () => {
    const game = useGameStore();
    game.totalTokensEarned = 99_999;
    const wrapper = mount(PrestigePanel);
    expect(wrapper.find(".prestige-panel").exists()).toBe(false);
  });

  it("becomes visible at the reveal threshold and stays visible after (discovery gate)", () => {
    const game = useGameStore();
    game.totalTokensEarned = 100_000;
    const wrapper = mount(PrestigePanel);
    expect(wrapper.find(".prestige-panel").exists()).toBe(true);
  });

  it("shows a disabled button below the prestige threshold", () => {
    const game = useGameStore();
    game.totalTokensEarned = 500_000;
    game.runTokensEarned = 500_000;
    const wrapper = mount(PrestigePanel);
    const btn = wrapper.find(".prestige-btn");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.classes()).not.toContain("ready");
  });

  it("enables the button once at least 1 PhD is available", () => {
    const game = useGameStore();
    game.totalTokensEarned = 1_000_000;
    game.runTokensEarned = 1_000_000;
    const wrapper = mount(PrestigePanel);
    const btn = wrapper.find(".prestige-btn");
    expect(btn.attributes("disabled")).toBeUndefined();
    expect(btn.classes()).toContain("ready");
  });

  it("clicking the button opens the confirm modal without calling game.prestige directly", async () => {
    const game = useGameStore();
    game.totalTokensEarned = 1_000_000;
    game.runTokensEarned = 1_000_000;
    const ui = useUiStore();
    const wrapper = mount(PrestigePanel);

    await wrapper.find(".prestige-btn").trigger("click");

    expect(ui.prestigeConfirmOpen).toBe(true);
    expect(game.phdCount).toBe(0); // prestige() was not called
    expect(game.runTokensEarned).toBe(1_000_000); // unchanged
  });

  it("still visible and correctly showing owned PhDs after a prestige", () => {
    const game = useGameStore();
    game.totalTokensEarned = 4_000_000;
    game.runTokensEarned = 4_000_000;
    game.prestige();
    const wrapper = mount(PrestigePanel);
    expect(wrapper.find(".prestige-panel").exists()).toBe(true);
    expect(wrapper.find(".phd-count").text()).toBe("2");
  });

  describe("sidebar no longer shows the multiplier preview (moved to the confirm modal)", () => {
    // Regression: the panel used to duplicate PrestigeConfirmModal.vue's
    // before/after table as chips + an "After: ..." line. Those numbers now
    // live only in the confirm modal.
    it("shows no multiplier chips or after-line at any PhD count", () => {
      const game = useGameStore();
      game.totalTokensEarned = 1_000_000;
      game.phdCount = 1;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".mult-chip").exists()).toBe(false);
      expect(wrapper.find(".after-line").exists()).toBe(false);
      expect(wrapper.find(".ready-headline").exists()).toBe(false);
    });
  });

  describe("pending PhD count", () => {
    it("below the threshold: shows the not-ready progress block", () => {
      const game = useGameStore();
      game.totalTokensEarned = 500_000;
      game.runTokensEarned = 500_000;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".progress-caption").exists()).toBe(true);
    });

    it("at 1 PhD ready: relabels the progress bar and drops the caption", () => {
      const game = useGameStore();
      game.totalTokensEarned = 1_000_000;
      game.runTokensEarned = 1_000_000;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".progress-caption").exists()).toBe(false);
    });
  });
});
