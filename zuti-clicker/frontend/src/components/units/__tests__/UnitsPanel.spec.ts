import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import UnitsPanel from "@/components/units/UnitsPanel.vue";
import { useGameStore } from "@/stores/gameStore";
import { useUiStore } from "@/stores/uiStore";

describe("UnitsPanel — clearance discount chip", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("no chip when no cost-reduction booster is active", () => {
    const wrapper = mount(UnitsPanel);
    expect(wrapper.find(".discount-chip").exists()).toBe(false);
  });

  it("shows the discount chip on the Units tab while clearance is active", () => {
    const game = useGameStore();
    game.grantBooster("clearance", 120_000);

    const wrapper = mount(UnitsPanel);
    expect(wrapper.find(".discount-chip").exists()).toBe(true);
    expect(wrapper.find(".discount-chip").text()).toContain("25");
  });

  // buyUpgrade/canAffordUpgrade use each upgrade's raw cost — the clearance
  // booster never discounts upgrades, so the chip must not claim it does
  // while that tab is active.
  it("hides the chip on the Upgrades tab even while clearance is active", () => {
    const game = useGameStore();
    const ui = useUiStore();
    game.grantBooster("clearance", 120_000);
    ui.shopTab = "upgrades";

    const wrapper = mount(UnitsPanel);
    expect(wrapper.find(".discount-chip").exists()).toBe(false);
  });
});
