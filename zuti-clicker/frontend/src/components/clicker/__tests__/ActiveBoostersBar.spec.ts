import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import ActiveBoostersBar from "@/components/clicker/ActiveBoostersBar.vue";
import { useGameStore } from "@/stores/gameStore";

describe("ActiveBoostersBar", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when no booster is active", () => {
    const wrapper = mount(ActiveBoostersBar);
    expect(wrapper.find(".booster-chip").exists()).toBe(false);
  });

  // The headline finding this fixes: a fantasy name alone ("Pop Quiz") tells
  // a new player nothing about what's actually boosted. Each active-buff
  // chip must now also show its concrete effect.
  it("shows the booster's name and its concrete effect, not just the name", () => {
    const game = useGameStore();
    game.grantBooster("clickStorm", 90_000);

    const wrapper = mount(ActiveBoostersBar);
    const chip = wrapper.find(".booster-chip");
    expect(chip.exists()).toBe(true);
    expect(chip.text()).toContain("Pop Quiz");
    expect(chip.text()).toContain("×10 per click");
  });

  it("shows the production booster's multiplier", () => {
    const game = useGameStore();
    game.grantBooster("frenzy", 60_000);

    const wrapper = mount(ActiveBoostersBar);
    expect(wrapper.find(".booster-chip").text()).toContain("×7 production");
  });

  it("shows the cost-reduction booster's discount as a percentage", () => {
    const game = useGameStore();
    game.grantBooster("clearance", 120_000);

    const wrapper = mount(ActiveBoostersBar);
    expect(wrapper.find(".booster-chip").text()).toContain("-25% prices");
  });

  it("stops showing a chip once its booster expires", async () => {
    vi.useFakeTimers();
    const game = useGameStore();
    game.grantBooster("frenzy", 5_000);

    const wrapper = mount(ActiveBoostersBar);
    expect(wrapper.find(".booster-chip").exists()).toBe(true);

    // The chip's own 1Hz clock (not gameStore.tick()) drives its countdown —
    // advancing fake timers fires it, and the pills computed re-filters.
    vi.advanceTimersByTime(6_000);
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".booster-chip").exists()).toBe(false);
  });
});
