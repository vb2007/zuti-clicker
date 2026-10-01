import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
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

  it("is aria-disabled and non-affordable-styled when tokens are insufficient", () => {
    const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
    // aria-disabled, not `disabled`: a locked tile must stay focusable/hoverable so its
    // tooltip (what it does) can still be read before it is affordable.
    expect(wrapper.find(".upgrade-tile").attributes("aria-disabled")).toBe("true");
    expect(wrapper.find(".upgrade-tile").attributes("disabled")).toBeUndefined();
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

    it("is aria-disabled while restricted, even though affordable — and does not buy", async () => {
      const game = useGameStore();
      game.tokens = 200;
      useAntiCheatStore().isRestricted = true;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
      expect(wrapper.find(".upgrade-tile").attributes("aria-disabled")).toBe("true");
      await dispatchTrusted(wrapper.find(".upgrade-tile").element, "click");
      expect(game.tokens).toBe(200);
      expect(game.isUpgradeOwned("chalk")).toBe(false);
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
      useGameStore().tokens = 200;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } });
      await wrapper.find(".upgrade-tile").trigger("focus");
      const tip = body().find(".tooltip");
      expect(tip.text()).toContain("Chalk");
      expect(tip.text()).toContain("+1");
      wrapper.unmount(); // before the raw body wipe — see UnitCard.spec's tooltip describe
    });

    it("an unaffordable (locked) tile still shows its tooltip — what it does can be read before it can be bought", async () => {
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" } }); // 0 tokens
      await wrapper.find(".upgrade-tile").trigger("focus");
      expect(body().find(".tooltip").text()).toContain("Chalk");
      wrapper.unmount();
    });
  });

  // Touch users have no hover, and a tap buys — so previewing an upgrade is a
  // long-press. It must never get in the way of tapping quickly to buy.
  describe("touch long-press preview", () => {
    const LONG_PRESS_MS = 500;
    const touch = (type: string, x = 50, y = 50) =>
      new PointerEvent(type, { pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true });

    async function press(el: Element, type: string, x?: number, y?: number) {
      el.dispatchEvent(touch(type, x, y));
      await nextTick();
    }
    // A real tap: pointerdown, (short wait), pointerup, then the browser's click.
    async function tap(el: Element, heldMs = 80) {
      await press(el, "pointerdown");
      await vi.advanceTimersByTimeAsync(heldMs);
      await press(el, "pointerup");
      await dispatchTrusted(el, "click");
    }

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("holding past the threshold opens the tooltip and does NOT buy", async () => {
      const game = useGameStore();
      game.tokens = 200;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      const tile = wrapper.find(".upgrade-tile").element;

      await press(tile, "pointerdown");
      expect(body().find(".tooltip").exists()).toBe(false); // not yet
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
      expect(body().find(".tooltip").text()).toContain("Chalk");

      await press(tile, "pointerup");
      await dispatchTrusted(tile, "click"); // the click the browser fires after release
      expect(game.tokens).toBe(200);
      expect(game.isUpgradeOwned("chalk")).toBe(false);
      wrapper.unmount();
    });

    it("works on a locked (unaffordable) tile, which is the point", async () => {
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      await press(wrapper.find(".upgrade-tile").element, "pointerdown");
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
      expect(body().find(".tooltip").exists()).toBe(true);
      wrapper.unmount();
    });

    // The requirement that matters most: fast tapping must never be mistaken for a long press.
    it("regression: rapid tapping (~80ms a tap) never arms the preview and buys every time", async () => {
      const game = useGameStore();
      game.tokens = 1_000_000;
      game.totalTokensEarned = 1_000_000;
      const ids = ["chalk", "redPen", "laserPointer", "overheadProjector", "firmHandshake"];
      const wrappers = ids.map((id) =>
        mount(UpgradeTile, { props: { upgradeId: id }, attachTo: document.body })
      );
      for (const w of wrappers) await tap(w.find(".upgrade-tile").element);

      expect(ids.every((id) => game.isUpgradeOwned(id))).toBe(true);
      expect(body().find(".tooltip").exists()).toBe(false);
      wrappers.forEach((w) => w.unmount());
    });

    it("regression: tapping the SAME affordable tile again right after releasing a short tap still buys on the next press", async () => {
      // chalk is one-time, so use two press cycles on different state: a quick tap that
      // buys, and a long-press on a second tile right after — the first tap's flag must
      // not leak into the second tile or swallow anything.
      const game = useGameStore();
      game.tokens = 1_000_000;
      const a = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      const b = mount(UpgradeTile, { props: { upgradeId: "redPen" }, attachTo: document.body });

      await tap(a.find(".upgrade-tile").element);
      expect(game.isUpgradeOwned("chalk")).toBe(true);

      // long-press the second: preview, no buy
      const tileB = b.find(".upgrade-tile").element;
      await press(tileB, "pointerdown");
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
      await press(tileB, "pointerup");
      await dispatchTrusted(tileB, "click");
      expect(game.isUpgradeOwned("redPen")).toBe(false);

      // …and the very next ordinary tap on it buys (the swallow was one-shot)
      await tap(tileB);
      expect(game.isUpgradeOwned("redPen")).toBe(true);
      a.unmount();
      b.unmount();
    });

    it("a press that lifts just before the threshold is a tap, not a preview", async () => {
      const game = useGameStore();
      game.tokens = 200;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      await tap(wrapper.find(".upgrade-tile").element, LONG_PRESS_MS - 50);
      expect(game.isUpgradeOwned("chalk")).toBe(true);
      expect(body().find(".tooltip").exists()).toBe(false);
      wrapper.unmount();
    });

    it("moving the finger (a scroll/drag) cancels the pending preview", async () => {
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      const tile = wrapper.find(".upgrade-tile").element;
      await press(tile, "pointerdown", 50, 50);
      await vi.advanceTimersByTimeAsync(200);
      await press(tile, "pointermove", 50, 90); // 40px: well past the tolerance
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
      expect(body().find(".tooltip").exists()).toBe(false);
      wrapper.unmount();
    });

    it("a browser-cancelled press (pointercancel, e.g. scrolling took over) never previews", async () => {
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      const tile = wrapper.find(".upgrade-tile").element;
      await press(tile, "pointerdown");
      await press(tile, "pointercancel");
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 100);
      expect(body().find(".tooltip").exists()).toBe(false);
      wrapper.unmount();
    });

    it("the swallowed click expires, so a later keyboard activation is not eaten", async () => {
      const game = useGameStore();
      game.tokens = 200;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      const tile = wrapper.find(".upgrade-tile").element;
      await press(tile, "pointerdown");
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
      await press(tile, "pointerup"); // …and, unusually, no click follows
      await vi.advanceTimersByTimeAsync(1000);
      await dispatchTrusted(tile, "click"); // e.g. Enter on the focused tile
      expect(game.isUpgradeOwned("chalk")).toBe(true);
      wrapper.unmount();
    });

    it("mouse presses are unaffected: no preview timer, an ordinary click buys at once", async () => {
      const game = useGameStore();
      game.tokens = 200;
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      const tile = wrapper.find(".upgrade-tile").element;
      tile.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }));
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 100);
      expect(body().find(".tooltip").exists()).toBe(false);
      await dispatchTrusted(tile, "click");
      expect(game.isUpgradeOwned("chalk")).toBe(true);
      wrapper.unmount();
    });

    it("tapping elsewhere dismisses a preview left open", async () => {
      const wrapper = mount(UpgradeTile, { props: { upgradeId: "chalk" }, attachTo: document.body });
      await press(wrapper.find(".upgrade-tile").element, "pointerdown");
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS + 10);
      expect(body().find(".tooltip").exists()).toBe(true);

      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      await nextTick();
      expect(body().find(".tooltip").exists()).toBe(false);
      wrapper.unmount();
    });
  });
});
