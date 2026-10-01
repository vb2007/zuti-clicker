import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper, type VueWrapper } from "@vue/test-utils";
import PrestigeCeremony from "@/components/prestige/PrestigeCeremony.vue";
import { useUiStore } from "@/stores/uiStore";
import { __resetOverlayStackForTests } from "@/composables/useOverlayStack";

describe("PrestigeCeremony", () => {
  let wrapper: VueWrapper | null = null;
  const body = () => new DOMWrapper(document.body);

  beforeEach(() => {
    setActivePinia(createPinia());
    __resetOverlayStackForTests();
    document.body.innerHTML = "";
    // The count-up is driven by requestAnimationFrame + performance.now.
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    vi.spyOn(window.history, "back").mockImplementation(() => {});
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    document.body.innerHTML = "";
    __resetOverlayStackForTests();
  });

  function open(gain: number) {
    const ui = useUiStore();
    ui.lastPrestigeGain = gain;
    ui.prestigeCeremonyOpen = true;
    wrapper = mount(PrestigeCeremony);
    return ui;
  }

  const settle = async () => {
    await vi.advanceTimersByTimeAsync(1200);
    await nextTick();
  };

  it("shows the gain with digit grouping once the count-up settles", async () => {
    open(1234567);
    await settle();
    expect(body().find(".gain-number").text()).toBe("+1,234,567");
  });

  // Regression: the Continue button used to be v-if'd in after the count-up,
  // which changed the centred content's height — the whole ceremony jumped
  // when it appeared, and on a short screen it could land out of reach.
  it("regression: Continue is always laid out, only hidden until the count-up settles", async () => {
    open(500);
    const btn = body().find(".continue-btn");
    expect(btn.exists()).toBe(true);
    expect(btn.classes()).toContain("pending");

    await settle();
    expect(body().find(".continue-btn").classes()).not.toContain("pending");
  });

  it("Continue dismisses the ceremony", async () => {
    const ui = open(500);
    await settle();
    await body().find(".continue-btn").trigger("click");
    expect(ui.prestigeCeremonyOpen).toBe(false);
  });

  it("Back and Escape are ignored during the count-up", async () => {
    const ui = open(500);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(ui.prestigeCeremonyOpen).toBe(true);
  });

  it("Back continues once the button is offered", async () => {
    const ui = open(500);
    await settle();
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await nextTick();
    expect(ui.prestigeCeremonyOpen).toBe(false);
  });
});
