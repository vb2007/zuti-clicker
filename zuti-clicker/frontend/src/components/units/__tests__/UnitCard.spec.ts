import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper } from "@vue/test-utils";
import UnitCard from "@/components/units/UnitCard.vue";
import { useGameStore } from "@/stores/gameStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { dispatchTrusted } from "@/__tests__/testEvents";

const body = () => new DOMWrapper(document.body);

describe("UnitCard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("alpha is always rendered", () => {
    const wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
    expect(wrapper.find(".unit-card").exists()).toBe(true);
  });

  it("theta is hidden below its reveal threshold and shown at/above it", () => {
    const game = useGameStore();
    game.totalTokensEarned = 32_999_999;
    const hidden = mount(UnitCard, { props: { unitId: "theta", multiplier: 1 } });
    expect(hidden.find(".unit-card").exists()).toBe(false);

    game.totalTokensEarned = 33_000_000;
    const shown = mount(UnitCard, { props: { unitId: "theta", multiplier: 1 } });
    expect(shown.find(".unit-card").exists()).toBe(true);
  });

  it("theta's reveal threshold is unaffected by the cost discount", () => {
    const game = useGameStore();
    game.phdCount = 100; // 50% cost discount
    game.totalTokensEarned = 32_999_999;
    const wrapper = mount(UnitCard, { props: { unitId: "theta", multiplier: 1 } });
    expect(wrapper.find(".unit-card").exists()).toBe(false);
  });

  it("the displayed cost reflects the PhD cost discount", () => {
    const game = useGameStore();
    game.phdCount = 100; // 50% off
    const wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
    expect(wrapper.find(".btn-cost").text()).toBe("5");
  });

  describe("tooltip", () => {
    // Extracting the tooltip shell into a shared TooltipCard.vue (nested one
    // component level deeper than before) made an existing test-hygiene gap
    // visible: a test that leaves the tooltip open doesn't unmount its
    // wrapper before the outer afterEach wipes document.body.innerHTML raw,
    // which can leave Vue's Teleport target bookkeeping referencing a node
    // that's already gone by the time the *next* test mounts and teleports
    // into <body> again. Explicitly unmounting here — before the raw DOM
    // wipe — is the correct fix (proper component teardown first, blunt DOM
    // cleanup only as a hygiene net after), not a workaround.
    let wrapper: ReturnType<typeof mount> | undefined;

    afterEach(() => {
      wrapper?.unmount();
      wrapper = undefined;
    });

    it("is closed until hovered or the info button is focused", () => {
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      expect(body().find(".tooltip").exists()).toBe(false);
    });

    it("opens on hovering the info button (pointer) and closes on mouseleave", async () => {
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".info-btn").trigger("mouseenter");
      expect(body().find(".tooltip").exists()).toBe(true);

      await wrapper.find(".info-btn").trigger("mouseleave");
      expect(body().find(".tooltip").exists()).toBe(false);
    });

    it("regression: hovering elsewhere on the card does not open it — only the info button does", async () => {
      // The icon is what visually signals "hover/tap here for more"; having
      // the whole row react to hover regardless made the icon look like
      // decoration, since the tooltip was already open by the time you
      // noticed it.
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".unit-card").trigger("mouseenter");
      expect(body().find(".tooltip").exists()).toBe(false);
    });

    it("regression: opens on focusing the info button, reaching it without a pointer", async () => {
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".info-btn").trigger("focus");
      expect(body().find(".tooltip").exists()).toBe(true);

      await wrapper.find(".info-btn").trigger("blur");
      expect(body().find(".tooltip").exists()).toBe(false);
    });

    it("is teleported to <body>, escaping any ancestor's overflow/transform clipping", async () => {
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".info-btn").trigger("focus");
      expect(wrapper.find(".tooltip").exists()).toBe(false); // not inside the component's own tree
      expect(body().find(".tooltip").exists()).toBe(true);
    });

    it("shows the unit's name, description, cost, and gain", async () => {
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".info-btn").trigger("focus");
      const tip = body().find(".tooltip");
      expect(tip.text()).toContain("Alpha");
      expect(tip.text()).toContain("A basic token generator.");
    });

    it("closes on scroll rather than going stale at a scrolled-past position", async () => {
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".info-btn").trigger("focus");
      expect(body().find(".tooltip").exists()).toBe(true);

      window.dispatchEvent(new Event("scroll"));
      await wrapper.vm.$nextTick();
      expect(body().find(".tooltip").exists()).toBe(false);
    });

    it("closes on window resize", async () => {
      wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".info-btn").trigger("mouseenter");
      expect(body().find(".tooltip").exists()).toBe(true);

      window.dispatchEvent(new Event("resize"));
      await wrapper.vm.$nextTick();
      expect(body().find(".tooltip").exists()).toBe(false);
    });
  });

  describe("anti-cheat gate", () => {
    it("a trusted click buys, deducting tokens and granting ownership", async () => {
      const game = useGameStore();
      game.tokens = 100;
      const wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await dispatchTrusted(wrapper.find(".buy-btn").element, "click");
      expect(game.tokens).toBe(90);
      expect(game.unitStates.find((u) => u.id === "alpha")?.owned).toBe(1);
    });

    it("an untrusted (synthetic) click does not buy, even though affordable", async () => {
      const game = useGameStore();
      game.tokens = 100;
      const wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      await wrapper.find(".buy-btn").trigger("click"); // untrusted by default
      expect(game.tokens).toBe(100);
      expect(game.unitStates.find((u) => u.id === "alpha")?.owned).toBe(0);
    });

    it("the buy button is disabled while restricted, even though affordable", () => {
      const game = useGameStore();
      game.tokens = 100;
      useAntiCheatStore().isRestricted = true;
      const wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      expect(wrapper.find(".buy-btn").attributes("disabled")).toBeDefined();
    });
  });

  describe("clearance booster discount", () => {
    it("does not tint the price when no cost-reduction booster is active", () => {
      const wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      expect(wrapper.find(".btn-cost").classes()).not.toContain("discounted");
    });

    it("tints the price while the clearance booster is active", () => {
      const game = useGameStore();
      game.grantBooster("clearance", 120_000);

      const wrapper = mount(UnitCard, { props: { unitId: "alpha", multiplier: 1 } });
      expect(wrapper.find(".btn-cost").classes()).toContain("discounted");
    });
  });
});
