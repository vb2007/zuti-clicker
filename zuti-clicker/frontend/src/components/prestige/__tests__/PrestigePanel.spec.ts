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

  describe("pending PhD count on the button", () => {
    // Regression: the panel never read game.phdGain at all — a player saw a
    // fully lit "ready" button and a progress bar, but no number telling
    // them how many PhDs they were actually about to get. It's now shown as
    // a "×N" suffix on the Defend Thesis button itself.
    it("below the threshold: shows the not-ready progress block, no gain on the button", () => {
      const game = useGameStore();
      game.totalTokensEarned = 500_000;
      game.runTokensEarned = 500_000;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".progress-caption").exists()).toBe(true);
      expect(wrapper.find(".btn-gain").exists()).toBe(false);
      expect(wrapper.find(".prestige-btn").text()).not.toContain("×");
    });

    it("at 1 PhD ready: shows ×1 on the button and the relabeled progress bar", () => {
      const game = useGameStore();
      game.totalTokensEarned = 1_000_000;
      game.runTokensEarned = 1_000_000;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".btn-gain").text()).toBe("×1");
      expect(wrapper.find(".progress-caption").exists()).toBe(false);
    });

    it("at multiple PhDs ready: the button reflects the exact pending count", () => {
      const game = useGameStore();
      game.totalTokensEarned = 9_000_000;
      game.runTokensEarned = 9_000_000; // getPhdGain(9e6) = 3
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".btn-gain").text()).toBe("×3");
    });

    it("a large gain is abbreviated through formatNumber rather than printed raw", () => {
      // getPhdGain(1_440_000_000_000) = floor(sqrt(1,440,000)) = 1200 exactly
      // (1200^2 = 1,440,000) — deliberately not a value that would
      // coincidentally format the same whether abbreviated or not.
      const game = useGameStore();
      game.totalTokensEarned = 1_440_000_000_000;
      game.runTokensEarned = 1_440_000_000_000;
      expect(game.phdGain).toBe(1200);
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".btn-gain").text()).toBe("×1.20K");
    });
  });

  describe("Upgrader entry button", () => {
    function revealed() {
      const game = useGameStore();
      game.totalTokensEarned = 1_000_000;
      return game;
    }

    it("is hidden until the player has prestiged at least once", () => {
      revealed();
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".upgrader-btn").exists()).toBe(false);
    });

    it("appears after the first prestige and opens the Upgrader", async () => {
      const game = revealed();
      game.prestigeCount = 1;
      const ui = useUiStore();
      const wrapper = mount(PrestigePanel);

      const btn = wrapper.find(".upgrader-btn");
      expect(btn.exists()).toBe(true);
      await btn.trigger("click");
      expect(ui.upgraderOpen).toBe(true);
    });

    // A one-way discovery gate (CLAUDE.md): keyed to a lifetime counter, so
    // spending or losing every PhD on the wheel never hides it again.
    it("regression: stays visible with no PhDs left — it is gated on prestigeCount, not the balance", () => {
      const game = revealed();
      game.prestigeCount = 2;
      game.phdCount = 0;
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".upgrader-btn").exists()).toBe(true);
    });

    it("the PhD count shows the held value while a spin is landing, then the real one", async () => {
      const game = revealed();
      game.prestigeCount = 1;
      game.phdCount = 100;
      game.holdPhdDisplay(100);
      game.applySpinResult(0, 1);
      const wrapper = mount(PrestigePanel);
      expect(wrapper.find(".phd-count").text()).toBe("100");

      game.releasePhdDisplay();
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".phd-count").text()).toBe("0");
    });
  });
});
