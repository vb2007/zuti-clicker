import { describe, it, expect, beforeEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { useSaveStore } from "@/stores/saveStore";
import { useAuthStore } from "@/stores/authStore";
import { useGameStore } from "@/stores/gameStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { SyncFlushError } from "@/stores/saveStore";
import { api, ApiError, SAVE_STALE_CODE } from "@/lib/api";

// Only `api` is replaced; the real ApiError / isStaleSaveError stay, so a test
// can throw a genuine STALE ApiError and the store's detection is the real one.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      save: {
        load: vi.fn(),
        store: vi.fn(),
        reset: vi.fn()
      },
      settings: {
        load: vi.fn(),
        store: vi.fn()
      }
    }
  };
});

function loginAs(id = 1) {
  const auth = useAuthStore();
  auth.user = { id, username: "u", email: "u@example.com" };
}

describe("saveStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.mocked(api.save.load).mockReset();
    vi.mocked(api.save.store).mockReset();
    vi.mocked(api.save.reset).mockReset();
    vi.mocked(api.settings.store).mockReset().mockResolvedValue({
      message: "ok",
      settings: {
        theme: "dark",
        language: "en",
        autosaveEnabled: true,
        autosaveIntervalSecs: 30,
        prestigeCeremony: "full",
        hideFromLeaderboards: false,
        updatedAt: new Date().toISOString()
      }
    });
  });

  describe("resetSave()", () => {
    it("calls both the API delete and game.hardReset()", async () => {
      loginAs();
      const game = useGameStore();
      game.tokens = 500;
      game.phdCount = 3;
      vi.mocked(api.save.reset).mockResolvedValue({ message: "ok" });

      const save = useSaveStore();
      await save.resetSave();

      expect(api.save.reset).toHaveBeenCalledTimes(1);
      expect(game.tokens).toBe(0);
      expect(game.phdCount).toBe(0);
      expect(save.lastSyncedAt).toBeNull();
    });

    it("a failed delete leaves local game state untouched and propagates", async () => {
      loginAs();
      const game = useGameStore();
      game.tokens = 500;
      vi.mocked(api.save.reset).mockRejectedValue(new Error("network down"));

      const save = useSaveStore();
      await expect(save.resetSave()).rejects.toThrow("network down");
      expect(game.tokens).toBe(500);
      // Surfaced via the existing sync-status indicator rather than silently
      // discarded — see the App.vue confirm-delete handler.
      expect(save.syncError).toBe("network down");
    });

    it("regression: after a reset, the next sync sends an all-zero payload (not the pre-reset data)", async () => {
      loginAs();
      const game = useGameStore();
      game.tokens = 999;
      game.totalTokensEarned = 999;
      game.phdCount = 5;
      vi.mocked(api.save.reset).mockResolvedValue({ message: "ok" });
      vi.mocked(api.save.store).mockResolvedValue({
        message: "ok",
        savedAt: new Date().toISOString()
      });

      const save = useSaveStore();
      await save.resetSave();
      await save.sync();

      expect(api.save.store).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(api.save.store).mock.calls[0]![0];
      expect(payload.tokens).toBe(0);
      expect(payload.totalTokensEarned).toBe(0);
      expect(payload.phdCount).toBe(0);
    });
  });

  describe("sync()", () => {
    it("is a no-op for guests", async () => {
      const save = useSaveStore();
      await save.sync();
      expect(api.save.store).not.toHaveBeenCalled();
    });

    it("a sync requested while one is in flight is queued and runs once more with the newer payload", async () => {
      loginAs();
      const game = useGameStore();
      game.tokens = 1;

      let resolveFirst!: (v: { message: string; savedAt: string }) => void;
      const firstCall = new Promise<{ message: string; savedAt: string }>((resolve) => {
        resolveFirst = resolve;
      });
      vi.mocked(api.save.store)
        .mockReturnValueOnce(firstCall)
        .mockResolvedValueOnce({ message: "ok", savedAt: new Date().toISOString() });

      const save = useSaveStore();
      const firstSync = save.sync(); // starts, awaiting firstCall
      game.tokens = 2; // mutate before the second sync request
      const secondSync = save.sync(); // queued, since isSyncing is true

      resolveFirst({ message: "ok", savedAt: new Date().toISOString() });
      await firstSync;
      await secondSync;
      // give the queued re-run (fired from `finally`) a chance to complete
      await new Promise((r) => setTimeout(r, 0));

      expect(api.save.store).toHaveBeenCalledTimes(2);
      const secondPayload = vi.mocked(api.save.store).mock.calls[1]![0];
      expect(secondPayload.tokens).toBe(2);
    });
  });

  describe("sync() — a save made before a wheel spin elsewhere (STALE)", () => {
    const loadedSave = {
      save: {
        tokens: 5,
        totalTokensEarned: 5,
        totalClicks: 0,
        elapsedSeconds: 0,
        phdCount: 40,
        prestigeCount: 1,
        upgraderSeq: 7,
        units: [],
        savedAt: new Date().toISOString()
      }
    };

    it("reloads the server's progress and tells the player — it is not shown as a sync error", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100; // the stale local balance
      vi.mocked(api.save.store).mockRejectedValue(
        new ApiError(409, "stale", { code: SAVE_STALE_CODE })
      );
      vi.mocked(api.save.load).mockResolvedValue(loadedSave);

      const save = useSaveStore();
      await save.sync();

      expect(api.save.load).toHaveBeenCalledTimes(1);
      expect(game.phdCount).toBe(40);
      expect(game.upgraderSeq).toBe(7);
      expect(save.syncError).toBeNull();
      expect(useToastStore().toasts).toHaveLength(1);
      expect(useToastStore().toasts[0]!.kind).toBe("error");
    });

    it("regression: the envelope's own 409 (no stale code) is a real sync error and does NOT reload", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      vi.mocked(api.save.store).mockRejectedValue(new ApiError(409, "could not be verified", {}));

      const save = useSaveStore();
      await save.sync();

      expect(api.save.load).not.toHaveBeenCalled();
      expect(game.phdCount).toBe(100);
      expect(save.syncError).toBe("could not be verified");
      expect(useToastStore().toasts).toHaveLength(0);
    });
  });

  describe("logging in after playing as a guest", () => {
    // The server has no record of a guest's wheel results, so a first save carrying
    // wheel-won PhDs would read as forged — and the guest's counter never matches 0.
    it("regression: wheel results made as a guest are dropped at login, and the player is told", async () => {
      const game = useGameStore();
      const save = useSaveStore(); // the watcher lives in the store
      void save;
      game.phdCount = 150; // 100 earned + 50 won on the wheel as a guest
      game.recordGuestSpin(50);

      loginAs();
      await nextTick();

      expect(game.phdCount).toBe(100);
      expect(game.guestUpgraderNet).toBe(0);
      expect(useToastStore().toasts).toHaveLength(1);
    });

    it("says nothing when the guest never spun", async () => {
      const game = useGameStore();
      useSaveStore();
      game.phdCount = 100;
      loginAs();
      await nextTick();
      expect(game.phdCount).toBe(100);
      expect(useToastStore().toasts).toHaveLength(0);
    });
  });

  describe("a stale save whose reload also fails", () => {
    it("regression: does not claim the progress was reloaded when it wasn't", async () => {
      loginAs();
      vi.mocked(api.save.store).mockRejectedValue(
        new ApiError(409, "stale", { code: SAVE_STALE_CODE })
      );
      vi.mocked(api.save.load).mockRejectedValue(new Error("offline"));

      const save = useSaveStore();
      await save.sync();

      expect(useToastStore().toasts).toHaveLength(0);
      expect(save.syncError).toBe("stale");
    });
  });

  describe("withSyncLock()", () => {
    const ok = () => ({ message: "ok", savedAt: new Date().toISOString() });

    it("flushes the current state first, then runs the work, in that order", async () => {
      loginAs();
      const game = useGameStore();
      game.tokens = 42;
      const order: string[] = [];
      vi.mocked(api.save.store).mockImplementation(async () => {
        order.push("flush");
        return ok();
      });

      const result = await useSaveStore().withSyncLock(async () => {
        order.push("work");
        return "done";
      });

      expect(order).toEqual(["flush", "work"]);
      expect(result).toBe("done");
      expect(vi.mocked(api.save.store).mock.calls[0]![0].tokens).toBe(42);
    });

    it("regression: a failed flush aborts — the work never runs — and throws SyncFlushError", async () => {
      loginAs();
      vi.mocked(api.save.store).mockRejectedValue(new ApiError(500, "boom", {}));
      const work = vi.fn().mockResolvedValue("x");

      const save = useSaveStore();
      const err = await save.withSyncLock(work).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SyncFlushError);
      expect((err as SyncFlushError).stale).toBe(false);
      expect(work).not.toHaveBeenCalled();
      expect(save.syncError).toBe("boom");
    });

    it("regression: a STALE flush reloads, aborts, and the work never runs", async () => {
      loginAs();
      vi.mocked(api.save.store).mockRejectedValue(
        new ApiError(409, "stale", { code: SAVE_STALE_CODE })
      );
      vi.mocked(api.save.load).mockResolvedValue({
        save: {
          tokens: 0,
          totalTokensEarned: 0,
          totalClicks: 0,
          elapsedSeconds: 0,
          upgraderSeq: 3,
          units: [],
          savedAt: new Date().toISOString()
        }
      });
      const work = vi.fn();

      const err = await useSaveStore().withSyncLock(work).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SyncFlushError);
      // Flagged stale so the caller doesn't add a second message to the one the
      // store already showed when it reloaded.
      expect((err as SyncFlushError).stale).toBe(true);
      expect(work).not.toHaveBeenCalled();
      expect(useGameStore().upgraderSeq).toBe(3);
    });

    it("regression: syncs requested while the lock is held send nothing until it is released, then run once with the newest state", async () => {
      loginAs();
      const game = useGameStore();
      game.tokens = 1;
      vi.mocked(api.save.store).mockResolvedValue(ok());

      const save = useSaveStore();
      let releaseWork!: () => void;
      const workGate = new Promise<void>((r) => {
        releaseWork = r;
      });
      const locked = save.withSyncLock(async () => {
        await workGate;
      });

      // Let the flush happen, then request two syncs mid-work (autosave + manual).
      await vi.waitFor(() => expect(api.save.store).toHaveBeenCalledTimes(1));
      game.tokens = 2;
      void save.sync();
      void save.sync();
      game.tokens = 3;
      await new Promise((r) => setTimeout(r, 10));
      expect(api.save.store).toHaveBeenCalledTimes(1); // still only the flush

      releaseWork();
      await locked;
      await vi.waitFor(() => expect(api.save.store).toHaveBeenCalledTimes(2));
      // Exactly one held sync ran (the two requests coalesced), with the latest state.
      await new Promise((r) => setTimeout(r, 10));
      expect(api.save.store).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.save.store).mock.calls[1]![0].tokens).toBe(3);
    });

    it("waits for a sync already in flight before flushing", async () => {
      loginAs();
      let resolveFirst!: (v: ReturnType<typeof ok>) => void;
      const first = new Promise<ReturnType<typeof ok>>((r) => {
        resolveFirst = r;
      });
      vi.mocked(api.save.store).mockReturnValueOnce(first).mockResolvedValue(ok());

      const save = useSaveStore();
      const inFlight = save.sync();
      const work = vi.fn().mockResolvedValue("x");
      const locked = save.withSyncLock(work);

      await new Promise((r) => setTimeout(r, 10));
      expect(api.save.store).toHaveBeenCalledTimes(1); // the flush is waiting its turn
      expect(work).not.toHaveBeenCalled();

      resolveFirst(ok());
      await inFlight;
      await locked;
      expect(api.save.store).toHaveBeenCalledTimes(2);
      expect(work).toHaveBeenCalledTimes(1);
    });

    it("regression: an in-flight sync that comes back stale aborts the spin instead of being swallowed", async () => {
      loginAs();
      let rejectFirst!: (e: unknown) => void;
      const first = new Promise<never>((_, reject) => {
        rejectFirst = reject;
      });
      vi.mocked(api.save.store).mockReturnValueOnce(first).mockResolvedValue(ok());
      vi.mocked(api.save.load).mockResolvedValue({ save: null });
      const work = vi.fn().mockResolvedValue("x");

      const save = useSaveStore();
      const inFlight = save.sync();
      const locked = save.withSyncLock(work).catch((e: unknown) => e);

      rejectFirst(new ApiError(409, "stale", { code: SAVE_STALE_CODE }));
      await inFlight;
      const err = await locked;

      expect(err).toBeInstanceOf(SyncFlushError);
      expect((err as SyncFlushError).stale).toBe(true);
      expect(work).not.toHaveBeenCalled();
    });

    it("releases the lock when the work throws, so syncs resume", async () => {
      loginAs();
      vi.mocked(api.save.store).mockResolvedValue(ok());
      const save = useSaveStore();

      await expect(
        save.withSyncLock(async () => {
          throw new Error("spin failed");
        })
      ).rejects.toThrow("spin failed");

      vi.mocked(api.save.store).mockClear();
      await save.sync();
      expect(api.save.store).toHaveBeenCalledTimes(1);
    });

    it("refuses a second concurrent lock", async () => {
      loginAs();
      vi.mocked(api.save.store).mockResolvedValue(ok());
      const save = useSaveStore();
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const first = save.withSyncLock(() => gate);
      await vi.waitFor(() => expect(api.save.store).toHaveBeenCalledTimes(1));

      await expect(save.withSyncLock(async () => "x")).rejects.toThrow(/already held/);
      release();
      await first;
    });

    it("guests: just runs the work — nothing to flush", async () => {
      const save = useSaveStore();
      const result = await save.withSyncLock(async () => "guest");
      expect(result).toBe("guest");
      expect(api.save.store).not.toHaveBeenCalled();
    });
  });

  describe("load()", () => {
    it("forwards the server save into game.loadFromSave", async () => {
      loginAs();
      vi.mocked(api.save.load).mockResolvedValue({
        save: {
          tokens: 42,
          totalTokensEarned: 100,
          totalClicks: 5,
          elapsedSeconds: 60,
          phdCount: 2,
          prestigeCount: 1,
          runTokensEarned: 10,
          runClicks: 1,
          runSeconds: 5,
          savedAt: "2026-01-01T00:00:00.000Z",
          units: [{ unitId: "alpha", owned: 3 }]
        }
      });

      const game = useGameStore();
      const save = useSaveStore();
      await save.load();

      expect(game.tokens).toBe(42);
      expect(game.phdCount).toBe(2);
      expect(save.lastSyncedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    });
  });

  describe("autosave timer", () => {
    it("restarts when settings.autosaveEnabled or autosaveIntervalSecs change", async () => {
      vi.useFakeTimers();
      loginAs();
      vi.mocked(api.save.store).mockResolvedValue({
        message: "ok",
        savedAt: new Date().toISOString()
      });

      const settings = useSettingsStore();
      useSaveStore();

      settings.autosaveIntervalSecs = 15;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(api.save.store).toHaveBeenCalledTimes(1);

      settings.autosaveEnabled = false;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(api.save.store).toHaveBeenCalledTimes(1); // no further calls once disabled

      vi.useRealTimers();
    });
  });
});
