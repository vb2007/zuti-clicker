import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import StatusColumn from "@/components/status/StatusColumn.vue";
import { useGameStore } from "@/stores/gameStore";

describe("StatusColumn — booster legibility", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("Per Second and Per Click show no badge when no booster is active", () => {
    const wrapper = mount(StatusColumn);
    expect(wrapper.findAll(".stat-badge")).toHaveLength(0);
  });

  // "frenzy" is the production booster (×7) — Per Second must reflect it,
  // Per Click must not.
  it("Per Second shows the production booster's multiplier; Per Click stays unboosted", () => {
    const game = useGameStore();
    game.grantBooster("frenzy", 60_000);

    const wrapper = mount(StatusColumn);
    const items = wrapper.findAll(".stat-item");
    const perSecond = items.find((i) => i.text().includes("Per Second"));
    const perClick = items.find((i) => i.text().includes("Per Click"));

    expect(perSecond?.classes()).toContain("boosted");
    expect(perSecond?.find(".stat-badge").text()).toBe("×7");
    expect(perClick?.classes()).not.toContain("boosted");
    expect(perClick?.find(".stat-badge").exists()).toBe(false);
  });

  // "clickStorm" is the click booster (×10) — Per Click must reflect it,
  // Per Second must not.
  it("Per Click shows the click booster's multiplier; Per Second stays unboosted", () => {
    const game = useGameStore();
    game.grantBooster("clickStorm", 90_000);

    const wrapper = mount(StatusColumn);
    const items = wrapper.findAll(".stat-item");
    const perSecond = items.find((i) => i.text().includes("Per Second"));
    const perClick = items.find((i) => i.text().includes("Per Click"));

    expect(perClick?.classes()).toContain("boosted");
    expect(perClick?.find(".stat-badge").text()).toBe("×10");
    expect(perSecond?.classes()).not.toContain("boosted");
  });
});
