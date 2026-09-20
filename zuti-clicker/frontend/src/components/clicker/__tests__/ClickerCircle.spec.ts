import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import ClickerCircle from "@/components/clicker/ClickerCircle.vue";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { dispatchTrusted } from "@/__tests__/testEvents";

describe("ClickerCircle", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a real <button>, reachable by keyboard", () => {
    const wrapper = mount(ClickerCircle);
    expect(wrapper.find(".circle-wrap").element.tagName).toBe("BUTTON");
  });

  it("earns from a left-button pointerdown", async () => {
    const wrapper = mount(ClickerCircle);
    await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 100, clientY: 150 });
    expect(wrapper.emitted("click")).toHaveLength(1);
    expect(wrapper.emitted("click")![0]).toEqual([{ x: 100, y: 150 }]);
  });

  it("regression: a right-click earns a token instead of only opening the context menu", async () => {
    const wrapper = mount(ClickerCircle);
    await dispatchTrusted(wrapper.element, "pointerdown", { button: 2, clientX: 40, clientY: 60 });
    expect(wrapper.emitted("click")).toHaveLength(1);

    // The browser's native context menu is suppressed.
    const ctxEvent = new Event("contextmenu", { bubbles: true, cancelable: true });
    wrapper.element.dispatchEvent(ctxEvent);
    expect(ctxEvent.defaultPrevented).toBe(true);
  });

  it("ignores the middle button so autoscroll/paste still work off the circle", async () => {
    const wrapper = mount(ClickerCircle);
    await dispatchTrusted(wrapper.element, "pointerdown", { button: 1, clientX: 10, clientY: 10 });
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("regression: does not double-count a real pointer click (pointerdown + its own follow-up click)", async () => {
    // detail >= 1 is what a genuine pointer-originated click carries (this is
    // what distinguishes it from a keyboard/synthetic one below) — this is
    // what the browser's own follow-up click after our pointerdown handler
    // looks like.
    //
    // This used to be guarded by a flag cleared on a 0ms setTimeout, racing
    // the browser's own click dispatch — a race a synchronous test can't
    // reproduce, but real hardware could and did lose, doubling every gain.
    // MouseEvent.detail sidesteps the race: it's set by the browser on the
    // event itself, nothing here has to time anything.
    const wrapper = mount(ClickerCircle);
    await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 5, clientY: 5 });
    await dispatchTrusted(wrapper.element, "click", { clientX: 5, clientY: 5, detail: 1 });
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("a real pointer click's own follow-up click event is skipped even with no preceding pointerdown in this test", async () => {
    const wrapper = mount(ClickerCircle);
    await dispatchTrusted(wrapper.element, "click", { detail: 1 });
    expect(wrapper.emitted("click")).toBeUndefined();
  });

  it("earns exactly once from a keyboard-triggered click (detail 0, no preceding pointerdown)", async () => {
    const wrapper = mount(ClickerCircle);
    await dispatchTrusted(wrapper.element, "click"); // detail defaults to 0, matching a real keyboard activation
    expect(wrapper.emitted("click")).toHaveLength(1);
  });

  it("a click presses the circle", async () => {
    const wrapper = mount(ClickerCircle);
    const circle = wrapper.find(".circle").element;
    await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
    expect(circle.classList.contains("circle-pressed")).toBe(true);
  });

  it("releases back to normal once no click has arrived for the hold duration", async () => {
    const wrapper = mount(ClickerCircle);
    const circle = wrapper.find(".circle").element;
    await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });

    vi.advanceTimersByTime(151); // just past the 150ms hold
    expect(circle.classList.contains("circle-pressed")).toBe(false);
  });

  it("regression: rapid spam keeps the circle continuously held rather than flickering per click", async () => {
    // The old model force-restarted a fixed-duration keyframe on every
    // click, which either looked out of sync (when nothing guarded against
    // re-entrancy) or, when a later fix throttled that restart to stop it
    // strobing, meant most clicks under fast spam produced no visible
    // feedback at all — the same "out of sync" complaint from a different
    // angle. This models Cookie Clicker's own cookie instead: every click
    // just holds the pressed state a little longer, so a burst of clicks
    // faster than the hold duration keeps it continuously pressed with zero
    // flicker in between, and every one of them still earns.
    const wrapper = mount(ClickerCircle);
    const circle = wrapper.find(".circle").element;

    await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 0, clientY: 0 });
    expect(circle.classList.contains("circle-pressed")).toBe(true);

    for (let i = 1; i <= 5; i++) {
      vi.advanceTimersByTime(50); // well inside the 150ms hold — never lapses
      await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: i, clientY: i });
      expect(circle.classList.contains("circle-pressed")).toBe(true);
    }
    expect(wrapper.emitted("click")).toHaveLength(6);

    // Only once clicks actually stop does it release, timed from the *last*
    // one, not the first.
    vi.advanceTimersByTime(151);
    expect(circle.classList.contains("circle-pressed")).toBe(false);
  });

  it("reports the correct input method to antiCheat.recordClick for left-click, right-click, and keyboard", async () => {
    const antiCheat = useAntiCheatStore();
    const spy = vi.spyOn(antiCheat, "recordClick");
    const wrapper = mount(ClickerCircle);

    await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
    expect(spy).toHaveBeenLastCalledWith(true, "primary");

    await dispatchTrusted(wrapper.element, "pointerdown", { button: 2, clientX: 1, clientY: 1 });
    expect(spy).toHaveBeenLastCalledWith(true, "secondary");

    await dispatchTrusted(wrapper.element, "click"); // detail 0 — keyboard activation
    expect(spy).toHaveBeenLastCalledWith(true, "keyboard");
  });

  it("the portrait cannot be dragged out of the circle", () => {
    const wrapper = mount(ClickerCircle);
    const img = wrapper.find("img");
    expect(img.attributes("draggable")).toBe("false");
  });

  it("a dragstart on the wrapper is suppressed", () => {
    const wrapper = mount(ClickerCircle);
    const event = new Event("dragstart", { bubbles: true, cancelable: true });
    wrapper.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  describe("anti-cheat gate", () => {
    it("an untrusted (synthetic) pointerdown earns nothing", async () => {
      const wrapper = mount(ClickerCircle);
      await dispatchTrusted(
        wrapper.element,
        "pointerdown",
        { button: 0, clientX: 1, clientY: 1 },
        false
      );
      expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("an untrusted (synthetic) keyboard-style click earns nothing", async () => {
      const wrapper = mount(ClickerCircle);
      await dispatchTrusted(wrapper.element, "click", {}, false);
      expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("a click while the document is hidden earns nothing", async () => {
      vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      const wrapper = mount(ClickerCircle);
      await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
      expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("a click while the document lacks focus earns nothing", async () => {
      vi.spyOn(document, "hasFocus").mockReturnValue(false);
      const wrapper = mount(ClickerCircle);
      await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
      expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("a trusted click while restricted never even emits — no +0 popup, no CPS advance", async () => {
      // Must behave like a disabled button: no press animation, no floating
      // number, no CPS-readout advance — not a click that silently earns
      // nothing while still looking like it landed. gameStore.clickToken()
      // is ALSO gated independently (see gameStore.spec.ts's "anti-cheat
      // restriction gate" tests) as a belt-and-braces measure against
      // calling the store directly, but that alone isn't enough for the UI.
      const antiCheat = useAntiCheatStore();
      antiCheat.isRestricted = true;
      const wrapper = mount(ClickerCircle);
      await dispatchTrusted(wrapper.element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
      expect(wrapper.emitted("click")).toBeUndefined();
    });
  });
});
