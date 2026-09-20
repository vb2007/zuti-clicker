import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import AppHeader from "@/components/layout/AppHeader.vue";
import { useGameStore } from "@/stores/gameStore";

describe("AppHeader — mobile mini-stats", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("the tokens/sec mini-stat is not boosted by default", () => {
    const wrapper = mount(AppHeader);
    expect(wrapper.find(".mini-tps").classes()).not.toContain("boosted");
  });

  // Regression: the tokens/sec mini-stat used to reuse the ⚡ glyph, the same
  // one boosters use — a boosted rate looked identical to an idle one here.
  it("marks the tokens/sec mini-stat as boosted while the production booster is active", () => {
    const game = useGameStore();
    game.grantBooster("frenzy", 60_000);

    const wrapper = mount(AppHeader);
    expect(wrapper.find(".mini-tps").classes()).toContain("boosted");
  });
});
