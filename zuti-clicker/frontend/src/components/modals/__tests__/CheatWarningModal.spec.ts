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
  // session, with no backoff and no cap. fetchStatus() itself never throws
  // (it catches internally — see antiCheatStore.ts), so a failed underlying
  // request still needs to retry SOME time later rather than get stuck
  // forever (see the clock-skew test below for why "never retry" is itself
  // a bug) — the point here is specifically that it's bounded to a 5s
  // backoff, not a per-second storm.
  it("regression: retries with a bounded backoff after a failure, never a per-second storm", async () => {
    loginAs();
    vi.mocked(api.anticheat.status).mockRejectedValue(new Error("network down"));
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(Date.now() + 1_000);
    mount(CheatWarningModal);

    await vi.advanceTimersByTimeAsync(1_500); // the first scheduled check fires (and fails)
    expect(api.anticheat.status).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000); // well under the 5s backoff — no retry yet
    expect(api.anticheat.status).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_500); // past the 5s backoff from the first attempt
    expect(api.anticheat.status).toHaveBeenCalledTimes(2); // exactly one retry, not a burst
  });

  // Regression (found in review): the fix above only rescheduled via a
  // `watch` on restrictedUntil's own timestamp — if the server's re-check
  // says "still restricted" with the EXACT SAME restrictedUntil (its clock
  // lagging slightly behind the client's right at the boundary), that
  // timestamp never changes, so the watch alone never fires again and no
  // further check ever gets scheduled — the modal would sit stuck at
  // "0:00" indefinitely with isRestricted still true.
  it("regression: still restricted with the SAME restrictedUntil (clock skew) still gets re-checked and eventually clears", async () => {
    loginAs();
    const sameRestrictedUntil = new Date(Date.now() + 1_000).toISOString();
    vi.mocked(api.anticheat.status)
      .mockResolvedValueOnce({ isRestricted: true, restrictedUntil: sameRestrictedUntil, strikeCount: 1 })
      .mockResolvedValue({ isRestricted: false, restrictedUntil: null, strikeCount: 1 });
    const antiCheat = useAntiCheatStore();
    antiCheat.isRestricted = true;
    antiCheat.restrictedUntil = new Date(sameRestrictedUntil);
    mount(CheatWarningModal);

    await vi.advanceTimersByTimeAsync(1_500); // first check — server confirms still restricted, same timestamp
    expect(api.anticheat.status).toHaveBeenCalledTimes(1);
    expect(antiCheat.isRestricted).toBe(true); // not stuck cleared, but not stuck silent either

    await vi.advanceTimersByTimeAsync(5_000); // backoff elapses — a SECOND check must still fire
    expect(api.anticheat.status).toHaveBeenCalledTimes(2);
    expect(antiCheat.isRestricted).toBe(false); // this time the server agrees it's over
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
