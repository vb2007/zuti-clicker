import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useBoosters } from "@/composables/useBoosters";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { api } from "@/lib/api";
import { BOOSTER_SPAWN_MIN_SECS } from "@/utils/gameConstants";

vi.mock("@/lib/api", () => ({
  api: {
    boosters: {
      claim: vi.fn()
    }
  },
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
}));

function loginAs(id = 1) {
  const auth = useAuthStore();
  auth.user = { id, username: "u", email: "u@example.com" };
}

// Mounts the composable inside a real component (matches useBreakpoint.spec.ts's
// pattern) so its onMounted/onUnmounted hooks — and useI18n() — actually run.
function mountBoosters() {
  let result: ReturnType<typeof useBoosters> | undefined;
  const wrapper = mount(
    defineComponent({
      setup: () => {
        result = useBoosters();
        return () => null;
      }
    })
  );
  return { wrapper, boosters: result! };
}

describe("useBoosters", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.boosters.claim).mockReset();
    vi.useFakeTimers();
    // Pin every random draw to the minimum of its range: the spawn wait
    // lands exactly on BOOSTER_SPAWN_MIN_SECS, and the visible-window roll
    // (drawn fresh once showPickup runs) lands on its own minimum too — both
    // deterministic, so forcePickupVisible can land inside the visible
    // window precisely instead of guessing an amount large enough to
    // *probably* hit it but small enough not to advance past it and back to
    // hidden again (advancing by "way more than the max spawn wait" doesn't
    // work: the visible window is much shorter than the spawn wait, so a
    // single huge jump can cycle through several full show/miss/respawn
    // loops and land back on hidden by chance).
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    randomSpy.mockRestore();
  });

  function forcePickupVisible() {
    vi.advanceTimersByTime(BOOSTER_SPAWN_MIN_SECS * 1000);
  }

  describe("logged in", () => {
    it("on success: grants the booster, announces via a booster toast, and reschedules from the server's nextAvailableInMs", async () => {
      loginAs();
      const game = useGameStore();
      const toast = useToastStore();
      vi.mocked(api.boosters.claim).mockResolvedValue({
        message: "Booster claimed.",
        boosterId: "frenzy",
        remainingMs: 60_000,
        nextAvailableInMs: 120_000
      });

      const { boosters } = mountBoosters();
      forcePickupVisible();
      expect(boosters.pickupVisible.value).toBe(true);

      await boosters.claimPickup();

      expect(game.activeBoosters).toHaveLength(1);
      expect(game.activeBoosters[0]!.id).toBe("frenzy");
      expect(toast.toasts.some((t) => t.kind === "booster")).toBe(true);
      expect(boosters.pickupVisible.value).toBe(false);
    });

    // "frenzy" is BOOSTER_DEFINITIONS' production booster (×7) — the toast
    // must say what it does, not just its fantasy name, so a new player can
    // tell "Grading Frenzy" apart from "Pop Quiz" without guessing.
    it("the claim toast states the booster's concrete effect, not just its name", async () => {
      loginAs();
      const toast = useToastStore();
      vi.mocked(api.boosters.claim).mockResolvedValue({
        message: "Booster claimed.",
        boosterId: "frenzy",
        remainingMs: 60_000,
        nextAvailableInMs: 120_000
      });

      const { boosters } = mountBoosters();
      forcePickupVisible();
      await boosters.claimPickup();

      const boosterToast = toast.toasts.find((t) => t.kind === "booster");
      expect(boosterToast?.message).toContain("Grading Frenzy");
      expect(boosterToast?.message).toContain("×7 production");
    });

    it("on 409 (cooldown drift): re-syncs the schedule silently — no error toast, no error thrown", async () => {
      loginAs();
      const toast = useToastStore();
      const { ApiError } = await import("@/lib/api");
      vi.mocked(api.boosters.claim).mockRejectedValue(
        new ApiError(409, "No booster is available to claim yet.", { nextAvailableInMs: 42_000 })
      );

      const { boosters } = mountBoosters();
      forcePickupVisible();

      await boosters.claimPickup();

      expect(toast.toasts.some((t) => t.kind === "error")).toBe(false);
    });

    // Regression: this used to treat EVERY rejection (401, network failure,
    // 500 — anything not the expected 409) as silent cooldown drift, giving
    // the player zero feedback while boosters just kept "trying" forever.
    it("regression: on a non-409 failure (e.g. an expired session), surfaces an error toast instead of swallowing it", async () => {
      loginAs();
      const toast = useToastStore();
      const { ApiError } = await import("@/lib/api");
      vi.mocked(api.boosters.claim).mockRejectedValue(new ApiError(401, "Unauthorized."));

      const { boosters } = mountBoosters();
      forcePickupVisible();

      await boosters.claimPickup();

      expect(toast.toasts.some((t) => t.kind === "error")).toBe(true);
    });
  });

  describe("guest", () => {
    it("claims fully locally — no API call, and still grants a booster", async () => {
      const game = useGameStore();
      expect(useAuthStore().isLoggedIn).toBe(false);

      const { boosters } = mountBoosters();
      forcePickupVisible();

      await boosters.claimPickup();

      expect(api.boosters.claim).not.toHaveBeenCalled();
      expect(game.activeBoosters).toHaveLength(1);
    });
  });

  it("clicking claimPickup while nothing is visible does nothing", async () => {
    const game = useGameStore();
    const { boosters } = mountBoosters();
    expect(boosters.pickupVisible.value).toBe(false);

    await boosters.claimPickup();

    expect(game.activeBoosters).toHaveLength(0);
    expect(api.boosters.claim).not.toHaveBeenCalled();
  });
});
