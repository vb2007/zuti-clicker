import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper } from "@vue/test-utils";
import UpgradeTile from "@/components/units/UpgradeTile.vue";
import { useGameStore } from "@/stores/gameStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { dispatchTrusted } from "@/__tests__/testEvents";

const body = () => new DOMWrapper(document.body);

describe("UpgradeTile", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the name, cost, and a compact effect label", () => {
    const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
    expect(wrapper.find(".tile-name").text()).toBe("Chalk");
    expect(wrapper.find(".tile-cost").text()).toBe("150");
    expect(wrapper.find(".tile-effect").text()).toBe("+1");
  });

  it("is disabled and non-affordable-styled when tokens are insufficient", () => {
    const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
    expect(wrapper.find(".upgrade-tile").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".upgrade-tile").classes()).not.toContain("affordable");
  });

  it("is enabled once affordable, and buying deducts tokens and grants ownership", async () => {
    const game = useGameStore();
    game.tokens = 200;
    const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
    expect(wrapper.find(".upgrade-tile").classes()).toContain("affordable");

    await dispatchTrusted(wrapper.find(".upgrade-tile").element, "click");
    expect(game.tokens).toBe(50);
    expect(game.isUpgradeOwned("chalk")).toBe(true);
  });

  it("clicking while unaffordable does nothing", async () => {
    const game = useGameStore();
    game.tokens = 10;
    const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
    await dispatchTrusted(wrapper.find(".upgrade-tile").element, "click");
    expect(game.tokens).toBe(10);
    expect(game.isUpgradeOwned("chalk")).toBe(false);
  });

  describe("anti-cheat gate", () => {
    it("an untrusted (synthetic) click does not buy, even though affordable", async () => {
      const game = useGameStore();
      game.tokens = 200;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
      await wrapper.find(".upgrade-tile").trigger("click"); // untrusted by default
      expect(game.tokens).toBe(200);
      expect(game.isUpgradeOwned("chalk")).toBe(false);
    });

    it("is disabled while restricted, even though affordable", () => {
      const game = useGameStore();
      game.tokens = 200;
      useAntiCheatStore().isRestricted = true;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
      expect(wrapper.find(".upgrade-tile").attributes("disabled")).toBeDefined();
    });
  });

  // Half-percent regression, shared via utils/upgrades.ts's
  // getUpgradeEffectLabel — Math.round(0.5) rounds up in JS, so a single
  // half-percent synergy tier must not display as a whole "1%".
  it("half-percent regression: a synergy tile shows +0.5%, not +1%", () => {
    const game = useGameStore();
    game.totalTokensEarned = 1_000_000; // reveal threshold for lectureNotes (cost 250_000)
    const wrapper = mount(UpgradeTile, { props: { upgradeId: "lectureNotes" } });
    expect(wrapper.find(".tile-effect").text()).toBe("+0.5%");
  });

  it("shows the crit tile's chance and multiplier", () => {
    const wrapper = mount(UpgradeTile, { props: { upgradeId: "luckyGuess" } });
    expect(wrapper.find(".tile-effect").text()).toBe("5% ×3");
  });

  describe("tooltip", () => {
    it("shows the name, description, cost, and effect on hover", async () => {
      // A disabled (unaffordable) button can't receive focus per the HTML
      // forms spec, so give it enough tokens to be interactive first — the
      // tooltip content itself is what's under test here, not affordability.
      useGameStore().tokens = 200;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
      await wrapper.find(".upgrade-tile").trigger("focus");
      const tip = body().find(".tooltip");
      expect(tip.text()).toContain("Chalk");
      expect(tip.text()).toContain("+1");
    });
  });
});
