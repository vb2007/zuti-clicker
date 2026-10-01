import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useUpgrader } from "@/composables/useUpgrader";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { api, ApiError, SAVE_STALE_CODE } from "@/lib/api";
import { UPGRADER_PPM } from "@/utils/gameConstants";

// Only `api` is replaced; the real ApiError / isStaleSaveError stay, so a test
// throws genuine ApiErrors and the stores' detection is the real one.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      save: { load: vi.fn(), store: vi.fn(), reset: vi.fn() },
      settings: { load: vi.fn(), store: vi.fn() },
      upgrader: { spin: vi.fn() }
    }
  };
});

function loginAs(id = 1) {
  useAuthStore().user = { id, username: "u", email: "u@example.com" };
}

function trustedClick(): Event {
  const e = new Event("click");
  Object.defineProperty(e, "isTrusted", { value: true });
  return e;
}

// Mounted inside a real component so useI18n() runs, like useBoosters.spec.ts.
function mountUpgrader() {
  let result: ReturnType<typeof useUpgrader> | undefined;
  mount(
    defineComponent({
      setup: () => {
        result = useUpgrader();
        return () => null;
      }
    })
  );
  return result!;
}

const savedOk = () => ({ message: "ok", savedAt: new Date().toISOString() });

function spinResponse(over: Record<string, unknown> = {}) {
  return {
    message: "Spin settled.",
    won: true,
    rollPpm: 100_000,
    winPpm: 450_000,
    payout: 200,
    phdCount: 200,
    upgraderSeq: 1,
    ...over
  };
}

describe("useUpgrader", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.save.store).mockReset().mockResolvedValue(savedOk());
    vi.mocked(api.save.load).mockReset();
    vi.mocked(api.upgrader.spin).mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  describe("logged in", () => {
    it("flushes the save first, then spins — the server must hold the pre-spin state", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      game.tokens = 77;
      const order: string[] = [];
      vi.mocked(api.save.store).mockImplementation(async () => {
        order.push("flush");
        return savedOk();
      });
      vi.mocked(api.upgrader.spin).mockImplementation(async () => {
        order.push("spin");
        return spinResponse();
      });

      await mountUpgrader().spin(100, 2, trustedClick());

      expect(order).toEqual(["flush", "spin"]);
      // The flush carried the pre-spin balance and counter.
      const payload = vi.mocked(api.save.store).mock.calls[0]![0];
      expect(payload.phdCount).toBe(100);
      expect(payload.upgraderSeq).toBe(0);
      expect(payload.tokens).toBe(77);
      expect(api.upgrader.spin).toHaveBeenCalledWith(100, 2);
    });

    it("applies a win: the server's balance and counter, and holds the old PhD readout", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      vi.mocked(api.upgrader.spin).mockResolvedValue(
        spinResponse({ won: true, phdCount: 200, upgraderSeq: 4 })
      );

      const upgrader = mountUpgrader();
      const outcome = await upgrader.spin(100, 2, trustedClick());

      expect(outcome).toMatchObject({ won: true, phdCount: 200, rollPpm: 100_000, winPpm: 450_000 });
      expect(outcome!.consolation).toBeUndefined();
      expect(game.phdCount).toBe(200);
      expect(game.upgraderSeq).toBe(4);
      expect(game.spinPending).toBe(false);
      // The readout still shows what it showed before the spin ...
      expect(game.phdCountDisplay).toBe(100);
      // ... until the wheel has stopped.
      upgrader.releaseReveal();
      expect(game.phdCountDisplay).toBe(200);
    });

    it("applies a loss with its consolation frenzy straight to the booster state", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      vi.mocked(api.upgrader.spin).mockResolvedValue(
        spinResponse({
          won: false,
          rollPpm: 900_000,
          phdCount: 0,
          upgraderSeq: 1,
          consolation: { boosterId: "frenzy", remainingMs: 30_000 }
        })
      );

      const outcome = await mountUpgrader().spin(100, 2, trustedClick());

      expect(outcome!.won).toBe(false);
      expect(game.phdCount).toBe(0);
      const frenzy = game.activeBoosters.find((b) => b.id === "frenzy");
      expect(frenzy).toBeDefined();
      expect(frenzy!.expiresAt - Date.now()).toBeGreaterThan(29_000);
      expect(frenzy!.expiresAt - Date.now()).toBeLessThanOrEqual(30_000);
    });

    // The reason spinPending exists: anything bought between the flush and the
    // result would be priced, by the server, at the post-spin PhD count.
    it("regression: purchases and prestige are refused for the whole spin, and allowed again after", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      game.tokens = 1_000_000;
      game.runTokensEarned = 4_000_000;
      const during: { buyUnit?: boolean; buyUpgrade?: boolean; prestige?: number; pending?: boolean } =
        {};
      vi.mocked(api.upgrader.spin).mockImplementation(async () => {
        during.pending = game.spinPending;
        during.buyUnit = game.buyUnit("alpha", 1);
        during.buyUpgrade = game.buyUpgrade("chalk");
        during.prestige = game.prestige();
        return spinResponse();
      });

      await mountUpgrader().spin(100, 2, trustedClick());

      expect(during).toEqual({ pending: true, buyUnit: false, buyUpgrade: false, prestige: 0 });
      expect(game.spinPending).toBe(false);
      expect(game.buyUnit("alpha", 1)).toBe(true);
    });

    it("also refuses purchases during the pre-spin flush, not only during the spin request", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      game.tokens = 1_000;
      let boughtDuringFlush: boolean | undefined;
      vi.mocked(api.save.store).mockImplementation(async () => {
        boughtDuringFlush = game.buyUnit("alpha", 1);
        return savedOk();
      });
      vi.mocked(api.upgrader.spin).mockResolvedValue(spinResponse());

      await mountUpgrader().spin(100, 2, trustedClick());
      expect(boughtDuringFlush).toBe(false);
    });

    it("a second spin while one is in flight does nothing", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      let resolveSpin!: (v: ReturnType<typeof spinResponse>) => void;
      vi.mocked(api.upgrader.spin).mockReturnValue(
        new Promise((r) => {
          resolveSpin = r;
        })
      );

      const upgrader = mountUpgrader();
      const first = upgrader.spin(50, 2, trustedClick());
      await vi.waitFor(() => expect(api.upgrader.spin).toHaveBeenCalledTimes(1));
      expect(await upgrader.spin(50, 2, trustedClick())).toBeNull();
      expect(api.upgrader.spin).toHaveBeenCalledTimes(1);

      resolveSpin(spinResponse());
      await first;
    });

    describe("failures leave the game untouched and say why", () => {
      function setup() {
        loginAs();
        const game = useGameStore();
        game.phdCount = 100;
        return { game, toast: useToastStore() };
      }

      it("not enough PhDs on the server (409 with the real balance): toast, reload, nothing applied", async () => {
        const { game, toast } = setup();
        vi.mocked(api.save.load).mockResolvedValue({ save: null });
        vi.mocked(api.upgrader.spin).mockRejectedValue(
          new ApiError(409, "You do not have that many PhDs to stake.", { phdCount: 40 })
        );

        const out = await mountUpgrader().spin(100, 2, trustedClick());

        expect(out).toBeNull();
        expect(game.phdCount).toBe(100);
        expect(game.upgraderSeq).toBe(0);
        expect(game.spinPending).toBe(false);
        expect(game.phdDisplayHold).toBeNull();
        expect(toast.toasts).toHaveLength(1);
        expect(api.save.load).toHaveBeenCalled();
      });

      it("a spin that would overflow (409 without a balance): toast, no reload", async () => {
        const { toast } = setup();
        vi.mocked(api.upgrader.spin).mockRejectedValue(new ApiError(409, "overflow", {}));
        expect(await mountUpgrader().spin(100, 2, trustedClick())).toBeNull();
        expect(toast.toasts).toHaveLength(1);
        expect(api.save.load).not.toHaveBeenCalled();
      });

      it("a 400 and an unexpected error each get a toast", async () => {
        const { toast, game } = setup();
        vi.mocked(api.upgrader.spin).mockRejectedValueOnce(new ApiError(400, "bad", {}));
        await mountUpgrader().spin(100, 2, trustedClick());
        vi.mocked(api.upgrader.spin).mockRejectedValueOnce(new Error("network"));
        await mountUpgrader().spin(100, 2, trustedClick());
        expect(toast.toasts).toHaveLength(2);
        expect(game.spinPending).toBe(false);
      });

      it("a 403 is left to the shared interceptor — no second, confusing toast", async () => {
        const { toast, game } = setup();
        vi.mocked(api.upgrader.spin).mockRejectedValue(new ApiError(403, "restricted", {}));
        expect(await mountUpgrader().spin(100, 2, trustedClick())).toBeNull();
        expect(toast.toasts).toHaveLength(0);
        expect(game.spinPending).toBe(false);
      });

      it("a failed pre-spin flush means the spin is never sent, and says so", async () => {
        const { toast, game } = setup();
        vi.mocked(api.save.store).mockRejectedValue(new ApiError(500, "boom", {}));

        expect(await mountUpgrader().spin(100, 2, trustedClick())).toBeNull();

        expect(api.upgrader.spin).not.toHaveBeenCalled();
        expect(toast.toasts).toHaveLength(1);
        expect(game.phdCount).toBe(100);
        expect(game.spinPending).toBe(false);
      });

      it("regression: a STALE flush shows only the store's own 'changed elsewhere' message, not a second one", async () => {
        const { toast } = setup();
        vi.mocked(api.save.store).mockRejectedValue(
          new ApiError(409, "stale", { code: SAVE_STALE_CODE })
        );
        vi.mocked(api.save.load).mockResolvedValue({ save: null });

        expect(await mountUpgrader().spin(100, 2, trustedClick())).toBeNull();

        expect(api.upgrader.spin).not.toHaveBeenCalled();
        expect(toast.toasts).toHaveLength(1);
      });
    });
  });

  describe("a spin whose outcome is unknown", () => {
    // A timeout / dropped connection / 5xx after the server committed: the client
    // can't tell whether PhDs changed. It must not assume either way.
    it.each([
      ["a network error", () => new Error("network")],
      ["a 502 from a proxy", () => new ApiError(502, "Bad gateway", {})],
      ["an unreadable reply", () => new SyntaxError("Unexpected token <")]
    ])("regression: %s says the outcome wasn't confirmed and reloads the server's state", async (_l, mk) => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      vi.mocked(api.save.load).mockResolvedValue({
        save: {
          tokens: 0,
          totalTokensEarned: 0,
          totalClicks: 0,
          elapsedSeconds: 0,
          phdCount: 60,
          upgraderSeq: 1,
          units: [],
          savedAt: new Date().toISOString()
        }
      });
      vi.mocked(api.upgrader.spin).mockRejectedValue(mk());

      expect(await mountUpgrader().spin(40, 2, trustedClick())).toBeNull();

      await vi.waitFor(() => expect(api.save.load).toHaveBeenCalled());
      // The server's word wins: the spin DID settle, and now the client knows.
      await vi.waitFor(() => expect(game.phdCount).toBe(60));
      expect(game.upgraderSeq).toBe(1);
      expect(game.spinPending).toBe(false);
      expect(useToastStore().toasts).toHaveLength(1);
    });

    it("a definite refusal (a 400/409) does NOT reload — nothing changed on the server", async () => {
      loginAs();
      useGameStore().phdCount = 100;
      vi.mocked(api.upgrader.spin).mockRejectedValue(new ApiError(400, "bad", {}));
      await mountUpgrader().spin(40, 2, trustedClick());
      expect(api.save.load).not.toHaveBeenCalled();
    });

    it("regression: a save deleted while the server was answering never gets the old result written onto it", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      vi.mocked(api.save.load).mockResolvedValue({ save: null });
      vi.mocked(api.upgrader.spin).mockImplementation(async () => {
        game.hardReset(); // the DELETE /save landed while the spin was in flight
        return spinResponse({ phdCount: 250, upgraderSeq: 9 });
      });

      expect(await mountUpgrader().spin(40, 2, trustedClick())).toBeNull();

      expect(game.phdCount).toBe(0);
      expect(game.upgraderSeq).toBe(0);
      expect(game.activeBoosters).toEqual([]);
    });
  });

  describe("guest results do not carry over to an account", () => {
    function stubRollLocal(rollPpm: number) {
      vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint32Array) => {
        arr[0] = rollPpm;
        return arr;
      }) as typeof crypto.getRandomValues);
    }

    it("remembers each guest spin's net PhDs", async () => {
      const game = useGameStore();
      game.phdCount = 100;
      stubRollLocal(449_999); // x2 win: +50
      await mountUpgrader().spin(50, 2, trustedClick());
      expect(game.guestUpgraderNet).toBe(50);
      stubRollLocal(UPGRADER_PPM - 1); // loss: -30
      await mountUpgrader().spin(30, 2, trustedClick());
      expect(game.guestUpgraderNet).toBe(20);
    });

    it("a logged-in spin does not touch it", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      vi.mocked(api.upgrader.spin).mockResolvedValue(spinResponse({ phdCount: 150, upgraderSeq: 1 }));
      await mountUpgrader().spin(50, 2, trustedClick());
      expect(game.guestUpgraderNet).toBe(0);
    });
  });

  describe("guard rails (any account)", () => {
    it("an untrusted click earns nothing and counts as an automation signal", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      const antiCheat = useAntiCheatStore();
      const recordClick = vi.spyOn(antiCheat, "recordClick");

      const out = await mountUpgrader().spin(100, 2, new Event("click"));

      expect(out).toBeNull();
      expect(recordClick).toHaveBeenCalledWith(false);
      expect(api.save.store).not.toHaveBeenCalled();
      expect(api.upgrader.spin).not.toHaveBeenCalled();
      expect(game.phdCount).toBe(100);
    });

    it("a restricted account cannot spin", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 100;
      useAntiCheatStore().isRestricted = true;

      expect(await mountUpgrader().spin(100, 2, trustedClick())).toBeNull();
      expect(api.upgrader.spin).not.toHaveBeenCalled();
      expect(game.spinPending).toBe(false);
    });

    it.each([
      ["a payout that would not exceed the stake (1 x 1.5)", 1, 1.5, 100],
      ["a stake above the PhDs owned", 101, 2, 100],
      ["a multiplier with a third decimal", 10, 1.005, 100],
      ["a multiplier below the minimum", 10, 1.19, 100],
      ["a zero stake", 0, 2, 100]
    ])("never sends %s", async (_label, stake, multiplier, phd) => {
      loginAs();
      useGameStore().phdCount = phd;
      expect(await mountUpgrader().spin(stake, multiplier, trustedClick())).toBeNull();
      expect(api.save.store).not.toHaveBeenCalled();
      expect(api.upgrader.spin).not.toHaveBeenCalled();
    });
  });

  describe("guest", () => {
    // 449_999 wins at x2 (45%); anything from 450_000 up loses.
    function stubRoll(rollPpm: number) {
      vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint32Array) => {
        arr[0] = rollPpm;
        return arr;
      }) as typeof crypto.getRandomValues);
    }

    it("settles locally with no network calls at all", async () => {
      const game = useGameStore();
      game.phdCount = 100;
      stubRoll(449_999);

      const out = await mountUpgrader().spin(100, 2, trustedClick());

      expect(out).toMatchObject({ won: true, rollPpm: 449_999, payout: 200, phdCount: 200 });
      expect(game.phdCount).toBe(200);
      // A guest's counter stays put: it only means something against a server save.
      expect(game.upgraderSeq).toBe(0);
      expect(api.save.store).not.toHaveBeenCalled();
      expect(api.upgrader.spin).not.toHaveBeenCalled();
    });

    it("a local loss takes the stake and grants a consolation frenzy proportional to the stake", async () => {
      const game = useGameStore();
      game.phdCount = 200;
      stubRoll(450_000);

      const out = await mountUpgrader().spin(100, 2, trustedClick());

      expect(out!.won).toBe(false);
      expect(game.phdCount).toBe(100);
      expect(out!.consolation).toEqual({ boosterId: "frenzy", remainingMs: 30_000 });
      expect(game.activeBoosters.some((b) => b.id === "frenzy")).toBe(true);
    });

    it("a loss on a tiny stake grants no frenzy (there is no minimum to farm)", async () => {
      const game = useGameStore();
      game.phdCount = 1_000_000;
      stubRoll(UPGRADER_PPM - 1);

      const out = await mountUpgrader().spin(2, 2, trustedClick());

      expect(out!.won).toBe(false);
      expect(out!.consolation).toBeUndefined();
      expect(game.activeBoosters).toEqual([]);
    });

    it("a loss extends a frenzy that is already running, capped at 120s remaining", async () => {
      const game = useGameStore();
      game.phdCount = 100;
      game.grantBooster("frenzy", 100_000);
      stubRoll(UPGRADER_PPM - 1);

      const out = await mountUpgrader().spin(100, 2, trustedClick());

      expect(out!.consolation!.remainingMs).toBe(120_000);
    });

    it("also holds purchases during the spin and releases the readout on demand", async () => {
      const game = useGameStore();
      game.phdCount = 100;
      stubRoll(UPGRADER_PPM - 1);
      const upgrader = mountUpgrader();

      await upgrader.spin(100, 2, trustedClick());

      expect(game.phdDisplayHold).toBe(100);
      expect(game.phdCountDisplay).toBe(100);
      upgrader.releaseReveal();
      expect(game.phdCountDisplay).toBe(0);
      expect(game.spinPending).toBe(false);
    });
  });
});
