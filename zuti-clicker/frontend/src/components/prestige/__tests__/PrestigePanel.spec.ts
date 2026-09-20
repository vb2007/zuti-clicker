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

  it("half-percent regression: 1 PhD shows -0.5% unit cost, not -1% (reported live)", () => {
    // Math.round(0.5) rounds UP in JS, so with the naive Math.round-based
    // display, 1 PhD's true 0.5% cost discount showed as "-1%" — exactly
    // double the real rate. Only visible at odd PhD counts (2 PhD's 1.0%
    // discount happens to round to the same "-1%" either way, which is
    // exactly why this went unnoticed until someone had exactly 1 PhD).
    const game = useGameStore();
    game.totalTokensEarned = 1_000_000;
    game.phdCount = 1;
    const wrapper = mount(PrestigePanel);
    const chips = wrapper.findAll(".mult-chip").map((c) => c.text());
    expect(chips.some((c) => c.startsWith("-0.5%"))).toBe(true);
    expect(chips.some((c) => c.startsWith("-1%"))).toBe(false);
  });

  describe("pending PhD count", () => {
    // Regression: the panel never read game.phdGain at all — a player saw a
    // fully lit "ready" button and a progress bar, but no number telling
    // them how many PhDs they were actually about to get.
    it("below the threshold: shows the not-ready progress block, no ready headline", () => {
      const game = useGameStore();
      game.totalTokensEarned = 500_000;
      game.runTokensEarned = 500_000;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".progress-caption").exists()).toBe(true);
      expect(wrapper.find(".ready-headline").exists()).toBe(false);
    });

    it("at 1 PhD ready: shows the pending gain and the relabeled progress bar", () => {
      const game = useGameStore();
      game.totalTokensEarned = 1_000_000;
      game.runTokensEarned = 1_000_000;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".ready-headline").text()).toContain("+1");
      expect(wrapper.find(".progress-caption").exists()).toBe(false);
    });

    it("at multiple PhDs ready: the headline reflects the exact pending count", () => {
      const game = useGameStore();
      game.totalTokensEarned = 9_000_000;
      game.runTokensEarned = 9_000_000; // getPhdGain(9e6) = 3
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".ready-headline").text()).toContain("+3");
    });

    it("the ready state's after-line shows the production/cost effect at the new total", () => {
      const game = useGameStore();
      game.phdCount = 0;
      game.totalTokensEarned = 4_000_000;
      game.runTokensEarned = 4_000_000; // getPhdGain(4e6) = 2 -> newPhdCount = 2
      const wrapper = mount(PrestigePanel);
      const after = wrapper.find(".after-line").text();
      expect(after).toContain("+4%"); // 2 PhD * 2% production
      expect(after).toContain("-1%"); // 2 PhD * 0.5% cost
    });
  });
});
