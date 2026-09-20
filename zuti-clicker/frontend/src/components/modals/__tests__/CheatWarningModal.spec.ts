import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper } from "@vue/test-utils";
import CheatWarningModal from "@/components/modals/CheatWarningModal.vue";
import { useAntiCheatStore } from "@/stores/antiCheatStore";

// Renders via <Teleport to="body"> (BaseModal) — see CLAUDE.md's Teleport
// testing note.
const body = () => new DOMWrapper(document.body);

describe("CheatWarningModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("is not shown when not restricted", () => {
    mount(CheatWarningModal);
    expect(body().find(".modal-body").exists()).toBe(false);
  });

  it("shows when restricted, with a countdown", () => {
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 90_000);
    mount(CheatWarningModal);
    expect(body().find(".modal-body").exists()).toBe(true);
    expect(body().find(".countdown-value").text()).toMatch(/1m/);
  });

  it("the countdown ticks down over time", async () => {
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 65_000);
    mount(CheatWarningModal);
    const before = body().find(".countdown-value").text();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(body().find(".countdown-value").text()).not.toBe(before);
  });

  it("dismiss closes the modal without lifting the restriction", async () => {
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 90_000);
    mount(CheatWarningModal);

    await body().find(".btn-primary").trigger("click");
    expect(body().find(".modal-body").exists()).toBe(false);
    expect(antiCheat.isRestricted).toBe(true); // untouched
  });

  it("a new restriction (different restrictedUntil) reopens it after a dismiss", async () => {
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 90_000);
    mount(CheatWarningModal);
    await body().find(".btn-primary").trigger("click");
    expect(body().find(".modal-body").exists()).toBe(false);

    antiCheat.restrictedUntil = new Date(Date.now() + 900_000); // a fresh, longer strike
    await nextTick();
    expect(body().find(".modal-body").exists()).toBe(true);
  });

  it("shows the strike-count note only on a repeat offense", () => {
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 90_000);
    antiCheat.strikeCount = 1;
    const first = mount(CheatWarningModal);
    expect(body().find(".strike-note").exists()).toBe(false);
    first.unmount();
    document.body.innerHTML = "";

    antiCheat.strikeCount = 3;
    mount(CheatWarningModal);
    expect(body().find(".strike-note").exists()).toBe(true);
  });
});
