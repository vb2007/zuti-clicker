import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { useAuthStore } from "@/stores/authStore";
import { api } from "@/lib/api";
import { BURST_CPS_CAP } from "@/utils/antiCheatConstants";

vi.mock("@/lib/api", () => ({
  api: {
    anticheat: {
      report: vi.fn(),
      status: vi.fn()
    }
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
}));

// happy-dom's EventTarget.prototype.dispatchEvent/HTMLElement.prototype.click
// are JS reimplementations, not natives — checkNativeIntegrity would report
// them as "patched" in every test regardless of anything this file does.
// integrityChecks.spec.ts covers that function's real behavior directly;
// here it's mocked out so it can't leak a false positive into these tests.
vi.mock("@/utils/integrityChecks", async () => {
  const actual = await vi.importActual<typeof import("@/utils/integrityChecks")>(
    "@/utils/integrityChecks"
  );
  return { ...actual, checkNativeIntegrity: vi.fn(() => []) };
});

function loginAs(id = 1) {
  const auth = useAuthStore();
  auth.user = { id, username: "u", email: "u@example.com" };
}

describe("antiCheatStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.body.innerHTML = "";
    vi.mocked(api.anticheat.report).mockReset().mockResolvedValue({
      message: "ok",
      status: "clean",
      restrictedUntil: null,
      strikeCount: 0
    });
    vi.mocked(api.anticheat.status).mockReset().mockResolvedValue({
      isRestricted: false,
      restrictedUntil: null,
      strikeCount: 0
    });
  });

  describe("recordClick()", () => {
    it("credits a trusted click under the burst cap", () => {
      const store = useAntiCheatStore();
      const outcome = store.recordClick(true);
      expect(outcome).toEqual({ credited: true, guestSaveReset: false });
    });

    it("silently drops a click once the burst cap is reached, without restricting", () => {
      const store = useAntiCheatStore();
      for (let i = 0; i < BURST_CPS_CAP; i++) store.recordClick(true);
      const outcome = store.recordClick(true);
      expect(outcome.credited).toBe(false);
      expect(store.isRestricted).toBe(false);
    });

    it("never credits an untrusted click", () => {
      const store = useAntiCheatStore();
      const outcome = store.recordClick(false);
      expect(outcome.credited).toBe(false);
    });

    it("an untrusted click immediately restricts a GUEST, tracked in localStorage", () => {
      const store = useAntiCheatStore();
      const outcome = store.recordClick(false);
      expect(store.isRestricted).toBe(true);
      expect(store.strikeCount).toBe(1);
      expect(store.restrictedUntil).not.toBeNull();
      expect(outcome.guestSaveReset).toBe(false);
      expect(localStorage.getItem("zuti-clicker:guestAntiCheatStrikes")).toBe("1");
    });

    it("an untrusted click does NOT restrict a logged-in account locally — that comes from the server", () => {
      loginAs();
      const store = useAntiCheatStore();
      store.recordClick(false);
      expect(store.isRestricted).toBe(false);
    });

    it("a guest's 5th strike reports guestSaveReset (no server save to delete)", () => {
      const store = useAntiCheatStore();
      let lastOutcome = { credited: true, guestSaveReset: false };
      for (let i = 0; i < 5; i++) lastOutcome = store.recordClick(false);
      expect(store.strikeCount).toBe(5);
      expect(lastOutcome.guestSaveReset).toBe(true);
    });
  });

  describe("sendHeartbeat() — guests", () => {
    it("never calls the API", async () => {
      const store = useAntiCheatStore();
      store.recordClick(true);
      await store.sendHeartbeat();
      expect(api.anticheat.report).not.toHaveBeenCalled();
    });

    it("a clean window never restricts a guest", async () => {
      const store = useAntiCheatStore();
      store.recordClick(true);
      await store.sendHeartbeat();
      expect(store.isRestricted).toBe(false);
    });
  });

  describe("sendHeartbeat() — logged in", () => {
    it("sends a digest whose click count matches recorded clicks", async () => {
      loginAs();
      const store = useAntiCheatStore();
      store.recordClick(true);
      store.recordClick(true);
      store.recordPurchase();
      await store.sendHeartbeat();
      expect(api.anticheat.report).toHaveBeenCalledTimes(1);
      const digest = vi.mocked(api.anticheat.report).mock.calls[0]![0];
      expect(digest.clicks).toBe(2);
      expect(digest.purchases).toBe(1);
    });

    it("tracks per-input-method counts (including Enter/Space separately) and resets them after each heartbeat", async () => {
      loginAs();
      const store = useAntiCheatStore();
      store.recordClick(true, "primary");
      store.recordClick(true, "primary");
      store.recordClick(true, "secondary");
      store.recordClick(true, "enter");
      store.recordClick(true, "space");
      await store.sendHeartbeat();

      const digest = vi.mocked(api.anticheat.report).mock.calls[0]![0];
      expect(digest.methodCounts).toEqual({ primary: 2, secondary: 1, enter: 1, space: 1 });

      await store.sendHeartbeat();
      const secondDigest = vi.mocked(api.anticheat.report).mock.calls[1]![0];
      expect(secondDigest.methodCounts).toEqual({ primary: 0, secondary: 0, enter: 0, space: 0 });
    });

    it("applies a restricted result from the server", async () => {
      loginAs();
      vi.mocked(api.anticheat.report).mockResolvedValue({
        message: "ok",
        status: "restricted",
        restrictedUntil: new Date(Date.now() + 60_000).toISOString(),
        strikeCount: 1
      });
      const store = useAntiCheatStore();
      await store.sendHeartbeat();
      expect(store.isRestricted).toBe(true);
      expect(store.strikeCount).toBe(1);
    });

    it("a failed report never throws and never blocks play", async () => {
      loginAs();
      vi.mocked(api.anticheat.report).mockRejectedValue(new Error("network down"));
      const store = useAntiCheatStore();
      await expect(store.sendHeartbeat()).resolves.toBe(false);
      expect(store.isRestricted).toBe(false);
    });
  });

  describe("fetchStatus()", () => {
    it("is a no-op (no API call) for guests", async () => {
      const store = useAntiCheatStore();
      await store.fetchStatus();
      expect(api.anticheat.status).not.toHaveBeenCalled();
    });

    it("applies the server's status for a logged-in account", async () => {
      loginAs();
      vi.mocked(api.anticheat.status).mockResolvedValue({
        isRestricted: true,
        restrictedUntil: new Date(Date.now() + 900_000).toISOString(),
        strikeCount: 2
      });
      const store = useAntiCheatStore();
      await store.fetchStatus();
      expect(store.isRestricted).toBe(true);
      expect(store.strikeCount).toBe(2);
    });

    it("clears an expired guest restriction (the countdown-reached-zero path)", async () => {
      vi.useFakeTimers();
      const store = useAntiCheatStore();
      store.recordClick(false); // strike 1 -> restricted for 1 minute
      expect(store.isRestricted).toBe(true);

      vi.advanceTimersByTime(60_001);
      await store.fetchStatus();
      expect(store.isRestricted).toBe(false);
      expect(store.restrictedUntil).toBeNull();
      vi.useRealTimers();
    });

    it("leaves a still-active guest restriction untouched", async () => {
      const store = useAntiCheatStore();
      store.recordClick(false);
      await store.fetchStatus();
      expect(store.isRestricted).toBe(true);
    });
  });

  describe("guest restriction persistence across a reload", () => {
    it("restores an active restriction in a fresh store instance", () => {
      const first = useAntiCheatStore();
      first.recordClick(false); // strike 1
      expect(first.isRestricted).toBe(true);

      // Simulate a page reload: a brand-new Pinia instance, same localStorage.
      setActivePinia(createPinia());
      const second = useAntiCheatStore();
      second.initialize();
      expect(second.isRestricted).toBe(true);
      expect(second.restrictedUntil).not.toBeNull();
      expect(second.strikeCount).toBe(1);
    });

    it("does not restore an already-expired restriction", () => {
      vi.useFakeTimers();
      const first = useAntiCheatStore();
      first.recordClick(false);
      vi.advanceTimersByTime(60_001);

      setActivePinia(createPinia());
      const second = useAntiCheatStore();
      second.initialize();
      expect(second.isRestricted).toBe(false);
      expect(second.restrictedUntil).toBeNull();
      vi.useRealTimers();
    });
  });

  describe("sendHeartbeat() also self-heals an expired guest restriction", () => {
    it("clears isRestricted once the restriction has expired, even without the modal open", async () => {
      vi.useFakeTimers();
      const store = useAntiCheatStore();
      store.recordClick(false);
      expect(store.isRestricted).toBe(true);

      vi.advanceTimersByTime(60_001);
      await store.sendHeartbeat();
      expect(store.isRestricted).toBe(false);
      vi.useRealTimers();
    });
  });
});
