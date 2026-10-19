import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useCareer } from "@/composables/useCareer";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { api, ApiError, CAREER_CODES, SAVE_STALE_CODE } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      save: { load: vi.fn(), store: vi.fn(), reset: vi.fn() },
      settings: { load: vi.fn(), store: vi.fn() },
      career: { buy: vi.fn(), refund: vi.fn(), close: vi.fn() }
    }
  };
});

function loginAs(id = 1) {
  useAuthStore().user = { id, username: "u", email: "u@example.com" };
}

function click(trusted = true): Event {
  const e = new Event("click");
  Object.defineProperty(e, "isTrusted", { value: trusted });
  return e;
}

function mountCareer() {
  let result: ReturnType<typeof useCareer> | undefined;
  mount(
    defineComponent({
      setup: () => {
        result = useCareer();
        return () => null;
      }
    })
  );
  return result!;
}

const savedOk = () => ({ message: "ok", savedAt: new Date().toISOString() });
const state = (over: Record<string, unknown> = {}) => ({
  message: "Node bought.",
  phdCount: 9,
  upgraderSeq: 4,
  career: {
    windowOpen: true,
    windowId: 2,
    phdInvested: 1,
    nodes: [{ nodeId: "habilitation", cost: 1, refundable: true }]
  },
  ...over
});

describe("useCareer", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.save.store).mockReset().mockResolvedValue(savedOk());
    vi.mocked(api.save.load).mockReset().mockResolvedValue({ save: null });
    vi.mocked(api.career.buy).mockReset();
    vi.mocked(api.career.refund).mockReset();
    vi.mocked(api.career.close).mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("logged in", () => {
    it("flushes the save first, holds purchases while pending, then adopts the server's state", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 10;
      game.applyCareerWindow(true, 2);
      const order: string[] = [];
      vi.mocked(api.save.store).mockImplementation(async () => {
        order.push("flush");
        return savedOk();
      });
      vi.mocked(api.career.buy).mockImplementation(async () => {
        order.push("buy");
        expect(game.careerPending).toBe(true);
        expect(game.buyUnit("alpha", 1)).toBe(false);
        return state();
      });
      const career = mountCareer();
      expect(await career.buy("habilitation", click())).toBe(true);
      expect(order).toEqual(["flush", "buy"]);
      expect(game.phdCount).toBe(9);
      expect(game.upgraderSeq).toBe(4);
      expect(game.careerNodeIds).toEqual(["habilitation"]);
      expect(game.careerPending).toBe(false);
    });

    it("a failed flush buys nothing and says so", async () => {
      loginAs();
      const game = useGameStore();
      game.applyCareerWindow(true, 1);
      vi.mocked(api.save.store).mockRejectedValue(new ApiError(500, "boom"));
      const career = mountCareer();
      expect(await career.buy("habilitation", click())).toBe(false);
      expect(api.career.buy).not.toHaveBeenCalled();
      expect(useToastStore().toasts.at(-1)?.message).toMatch(/save/i);
    });

    it("a career 409 adopts the server's real state carried in its body", async () => {
      loginAs();
      const game = useGameStore();
      game.phdCount = 50;
      game.applyCareerWindow(true, 1);
      vi.mocked(api.career.buy).mockRejectedValue(
        new ApiError(409, "closed", {
          code: CAREER_CODES.windowClosed,
          ...state({ phdCount: 3, career: { windowOpen: false, windowId: 1, phdInvested: 0, nodes: [] } })
        })
      );
      const career = mountCareer();
      expect(await career.buy("habilitation", click())).toBe(false);
      expect(game.careerWindowOpen).toBe(false);
      expect(game.phdCount).toBe(3);
    });

    it("an ambiguous failure (timeout, 5xx) reloads instead of assuming either outcome", async () => {
      loginAs();
      useGameStore().applyCareerWindow(true, 1);
      vi.mocked(api.career.refund).mockRejectedValue(new TypeError("network down"));
      const career = mountCareer();
      expect(await career.refund("habilitation", click())).toBe(false);
      expect(api.save.load).toHaveBeenCalled();
    });

    it("a stale flush has already reloaded and told the player — no second message", async () => {
      loginAs();
      useGameStore().applyCareerWindow(true, 1);
      vi.mocked(api.save.store).mockRejectedValue(
        new ApiError(409, "stale", { code: SAVE_STALE_CODE })
      );
      const career = mountCareer();
      const toasts = useToastStore();
      expect(await career.buy("habilitation", click())).toBe(false);
      expect(toasts.toasts.filter((t) => /couldn't save/i.test(t.message))).toHaveLength(0);
    });

    it("close sends the shown window id; a newer window keeps the tree up", async () => {
      loginAs();
      const game = useGameStore();
      game.applyCareerWindow(true, 2);
      vi.mocked(api.career.close).mockRejectedValue(
        new ApiError(409, "changed", {
          code: CAREER_CODES.windowChanged,
          ...state({ career: { windowOpen: true, windowId: 3, phdInvested: 0, nodes: [] } })
        })
      );
      const career = mountCareer();
      expect(await career.close()).toBe(false);
      expect(api.career.close).toHaveBeenCalledWith(2);
      expect(game.careerWindowOpen).toBe(true);
      expect(game.careerWindowId).toBe(3);
    });

    it("regression: close flushes first and adopts only the career, never a stale balance", async () => {
      loginAs();
      const game = useGameStore();
      // A prestige just opened the window locally; its save is what the flush sends.
      game.phdCount = 12;
      game.applyCareerWindow(true, 1);
      const order: string[] = [];
      vi.mocked(api.save.store).mockImplementation(async () => {
        order.push("flush");
        return savedOk();
      });
      vi.mocked(api.career.close).mockImplementation(async () => {
        order.push("close");
        // A reply whose balance predates something: it must not be adopted.
        return state({
          phdCount: 10,
          upgraderSeq: 99,
          career: { windowOpen: false, windowId: 1, phdInvested: 0, nodes: [] }
        });
      });
      const career = mountCareer();
      expect(await career.close()).toBe(true);
      expect(order).toEqual(["flush", "close"]);
      expect(game.careerWindowOpen).toBe(false);
      expect(game.phdCount).toBe(12);
      expect(game.upgraderSeq).toBe(0);
    });
  });

  describe("guest", () => {
    it("settles locally with the same rules", async () => {
      const game = useGameStore();
      game.phdCount = 10;
      game.applyCareerWindow(true, 1);
      const career = mountCareer();
      expect(await career.buy("habilitation", click())).toBe(true);
      expect(game.phdCount).toBe(9);
      expect(await career.refund("habilitation", click())).toBe(true);
      expect(game.phdCount).toBe(10);
      expect(await career.close()).toBe(true);
      expect(game.careerWindowOpen).toBe(false);
      expect(api.career.buy).not.toHaveBeenCalled();
    });
  });

  it("an untrusted (scripted) click buys nothing and counts as an automation signal", async () => {
    const game = useGameStore();
    game.phdCount = 10;
    game.applyCareerWindow(true, 1);
    const recordClick = vi.spyOn(useAntiCheatStore(), "recordClick");
    const career = mountCareer();
    expect(await career.buy("habilitation", click(false))).toBe(false);
    expect(recordClick).toHaveBeenCalledWith(false);
    expect(game.careerNodes).toEqual([]);
  });
});
