import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useBoosters } from "@/composables/useBoosters";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { api } from "@/lib/api";
import { CAREER_NODES_BY_ID, CAREER_CAPS } from "@/utils/careerCore";
import {
  BOOSTER_SPAWN_MIN_SECS,
  BOOSTER_VISIBLE_MIN_SECS,
  BOOSTER_DEFINITIONS
} from "@/utils/gameConstants";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      save: { load: vi.fn(), store: vi.fn(), reset: vi.fn() },
      settings: { load: vi.fn(), store: vi.fn() },
      boosters: { claim: vi.fn() }
    }
  };
});

const CONFERENCES = [
  "habilitation",
  "conferences.conferenceSeason",
  "conferences.callForPapers",
  "conferences.posterSession",
  "conferences.keynoteSpeaker"
];

function own(ids: string[]) {
  useGameStore().applyCareerState({
    career: {
      windowOpen: false,
      windowId: 1,
      phdInvested: 0,
      nodes: ids.map((nodeId) => ({
        nodeId,
        cost: CAREER_NODES_BY_ID.get(nodeId)!.cost,
        refundable: false
      }))
    }
  });
}

function mountBoosters() {
  let result: ReturnType<typeof useBoosters> | undefined;
  mount(
    defineComponent({
      setup: () => {
        result = useBoosters();
        return () => null;
      }
    })
  );
  return result!;
}

describe("useBoosters with the Academic Career", () => {
  let random: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setActivePinia(createPinia());
    // Logging in starts the autosave timer; these tests count every PUT /save.
    useSettingsStore().autosaveEnabled = false;
    vi.useFakeTimers();
    random = vi.spyOn(Math, "random").mockReturnValue(0);
    vi.mocked(api.boosters.claim).mockReset();
    vi.mocked(api.save.store)
      .mockReset()
      .mockResolvedValue({ message: "ok", savedAt: new Date().toISOString() });
  });
  afterEach(() => {
    vi.useRealTimers();
    random.mockRestore();
  });

  it("spawns sooner with Call for Papers, and keeps the pickup up longer with Poster Session", () => {
    own(CONFERENCES.slice(0, 4)); // +15% spawn, +25% window
    const boosters = mountBoosters();
    const divisor = 1.15;
    vi.advanceTimersByTime((BOOSTER_SPAWN_MIN_SECS * 1000) / divisor - 1);
    expect(boosters.pickupVisible.value).toBe(false);
    vi.advanceTimersByTime(2);
    expect(boosters.pickupVisible.value).toBe(true);
    expect(boosters.visibleWindowMs.value).toBeCloseTo(BOOSTER_VISIBLE_MIN_SECS * 1000 * 1.25, 6);
  });

  it("never waits less than the cooldown floor, however many spawn bonuses stack", () => {
    const game = useGameStore();
    // Not reachable with today's catalog — asserted against the store's own divisor.
    expect(BOOSTER_SPAWN_MIN_SECS / CAREER_CAPS.boosterSpawnDivisor).toBeGreaterThanOrEqual(
      CAREER_CAPS.boosterCooldownFloorSecs
    );
    expect(game.boosterSpawnMultiplier).toBe(1);
  });

  it("guest: a rolled windfall credits the unboosted production grant at once", async () => {
    own(CONFERENCES);
    const game = useGameStore();
    game.unitStates.find((u) => u.id === "alpha")!.owned = 10;
    const boosters = mountBoosters();
    vi.advanceTimersByTime(BOOSTER_SPAWN_MIN_SECS * 1000);
    // Land the weighted pick on windfall (just past the base pool's weight).
    const base = BOOSTER_DEFINITIONS.filter((d) => !d.career).reduce((s, d) => s + d.weight, 0);
    const total = base + 3;
    random.mockReturnValue((base + 0.5) / total);
    await boosters.claimPickup();
    // 60 s of 10 alpha x 0.3/s x the root's +10%.
    expect(game.tokens).toBeCloseTo(60 * 10 * 0.3 * 1.1, 6);
    expect(game.totalTokensEarned).toBeCloseTo(game.tokens, 10);
    expect(game.activeBoosters).toEqual([]);
    expect(useToastStore().toasts.at(-1)?.message).toMatch(/Research Windfall/);
  });

  it("logged in: with windfall in the pool, the claim flushes first and adopts the server's grant", async () => {
    useAuthStore().user = { id: 1, username: "u", email: "u@example.com" };
    own(CONFERENCES);
    const game = useGameStore();
    const order: string[] = [];
    vi.mocked(api.save.store).mockImplementation(async () => {
      order.push("flush");
      return { message: "ok", savedAt: new Date().toISOString() };
    });
    vi.mocked(api.boosters.claim).mockImplementation(async () => {
      order.push("claim");
      return {
        message: "Booster claimed.",
        boosterId: "windfall",
        remainingMs: 0,
        nextAvailableInMs: 90_000,
        windfall: { granted: 1234, upgraderSeq: 9 }
      };
    });
    const boosters = mountBoosters();
    vi.advanceTimersByTime(BOOSTER_SPAWN_MIN_SECS * 1000);
    await boosters.claimPickup();
    expect(order).toEqual(["flush", "claim"]);
    expect(game.tokens).toBe(1234);
    expect(game.runTokensEarned).toBe(1234);
    expect(game.upgraderSeq).toBe(9);
    expect(game.activeBoosters).toEqual([]);
  });

  it("logged in without windfall unlocked: no flush, a plain claim", async () => {
    useAuthStore().user = { id: 1, username: "u", email: "u@example.com" };
    vi.mocked(api.boosters.claim).mockResolvedValue({
      message: "Booster claimed.",
      boosterId: "frenzy",
      remainingMs: 60_000,
      nextAvailableInMs: 90_000
    });
    const boosters = mountBoosters();
    vi.advanceTimersByTime(BOOSTER_SPAWN_MIN_SECS * 1000);
    await boosters.claimPickup();
    expect(api.save.store).not.toHaveBeenCalled();
    expect(useGameStore().activeBoosters.map((b) => b.id)).toEqual(["frenzy"]);
  });
});
