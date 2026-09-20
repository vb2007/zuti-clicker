import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper } from "@vue/test-utils";
import CheatWarningModal from "@/components/modals/CheatWarningModal.vue";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { useAuthStore } from "@/stores/authStore";
import { api } from "@/lib/api";

// fetchStatus() is a no-op for guests (nothing to ask the server) — the two
// new tests below specifically exercise the server-check path, so they need
// a logged-in account, unlike the pre-existing tests here which only touch
// local store state directly.
function loginAs(id = 1) {
  const auth = useAuthStore();
  auth.user = { id, username: "u", email: "u@example.com" };
}

vi.mock("@/lib/api", () => ({
  api: { anticheat: { status: vi.fn(), report: vi.fn() } },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
}));

// Renders via <Teleport to="body"> (BaseModal) — see CLAUDE.md's Teleport
// testing note.
const body = () => new DOMWrapper(document.body);

describe("CheatWarningModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.mocked(api.anticheat.status).mockReset().mockResolvedValue({
      isRestricted: false,
      restrictedUntil: null,
      strikeCount: 0
    });
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

  it("checks the server exactly once when the countdown reaches zero, not on every tick before it", async () => {
    loginAs();
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 5_000);
    mount(CheatWarningModal);

    await vi.advanceTimersByTimeAsync(4_000); // still counting down — no call yet
    expect(api.anticheat.status).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_500); // past expiry + the clock-skew buffer
    expect(api.anticheat.status).toHaveBeenCalledTimes(1);
  });

  // Regression: this used to re-check "is now past restrictedUntil" on
  // every 1s countdown tick. If that single check's fetchStatus() call
  // ever failed (network blip) or restrictedUntil didn't update for any
  // reason, the exact same stale comparison kept re-firing every second
  // indefinitely — a permanent once-per-second poll for the rest of the
  // session, with no backoff and no cap.
  it("regression: does not keep polling every second after expiry if the status check fails", async () => {
    loginAs();
    vi.mocked(api.anticheat.status).mockRejectedValue(new Error("network down"));
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 1_000);
    mount(CheatWarningModal);

    await vi.advanceTimersByTimeAsync(1_500); // the one scheduled check fires (and fails)
    expect(api.anticheat.status).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000); // ten more seconds of countdown ticks
    expect(api.anticheat.status).toHaveBeenCalledTimes(1); // still just the one attempt — no per-second retry storm
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
