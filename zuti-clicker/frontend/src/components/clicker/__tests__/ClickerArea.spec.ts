import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import ClickerArea from "@/components/clicker/ClickerArea.vue";
import { CPS_WINDOW_MS } from "@/utils/gameConstants";
import { dispatchTrusted } from "@/__tests__/testEvents";

describe("ClickerArea — clicks-per-second pill", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is hidden until the player clicks", () => {
    const wrapper = mount(ClickerArea);
    expect(wrapper.find(".cps-pill").exists()).toBe(false);
  });

  it("shows a nonzero rate right after a click", async () => {
    const wrapper = mount(ClickerArea);
    await dispatchTrusted(wrapper.find(".circle-wrap").element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
    expect(wrapper.find(".cps-pill").exists()).toBe(true);
    expect(wrapper.find(".cps-val").text()).not.toBe("0.0");
  });

  // Regression: .cps-pill used to be a plain v-if flow child of
  // .clicker-content (a centered column flexbox), so mounting/unmounting it
  // changed the column's total height and visibly shifted the click circle
  // up and down. .cps-slot is always rendered at a fixed height so the pill
  // appearing/disappearing inside it never changes .clicker-content's height.
  it("regression: .cps-slot is always present at a fixed height, whether or not the pill is showing", async () => {
    const wrapper = mount(ClickerArea);

    const slotBeforeClick = wrapper.find(".cps-slot");
    expect(slotBeforeClick.exists()).toBe(true);
    expect(wrapper.find(".cps-pill").exists()).toBe(false);

    await dispatchTrusted(wrapper.find(".circle-wrap").element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
    expect(wrapper.find(".cps-slot").exists()).toBe(true);
    expect(wrapper.find(".cps-pill").exists()).toBe(true);
    // Same element throughout — never removed and re-added.
    expect(wrapper.find(".cps-slot").element).toBe(slotBeforeClick.element);
  });

  // Regression: recomputing cps only inside the click handler meant it never
  // re-ran once clicks stopped, so the pill froze at its last value forever
  // instead of decaying back to 0 and hiding — see ClickerArea.vue's
  // recomputeCps()/cpsInterval.
  it("regression: decays back to 0 and hides once clicking stops, without any further clicks", async () => {
    const wrapper = mount(ClickerArea);
    await dispatchTrusted(wrapper.find(".circle-wrap").element, "pointerdown", { button: 0, clientX: 1, clientY: 1 });
    expect(wrapper.find(".cps-pill").exists()).toBe(true);

    vi.advanceTimersByTime(CPS_WINDOW_MS + 500);
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".cps-pill").exists()).toBe(false);
  });
});
