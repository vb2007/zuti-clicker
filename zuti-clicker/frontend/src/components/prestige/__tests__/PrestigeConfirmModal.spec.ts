import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper } from "@vue/test-utils";
import PrestigeConfirmModal from "@/components/prestige/PrestigeConfirmModal.vue";
import { useGameStore } from "@/stores/gameStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { getProductionMultiplier, getCostMultiplier } from "@/utils/prestige";
import { formatPercent } from "@/utils/formatters";
import { dispatchTrusted } from "@/__tests__/testEvents";
import { useAuthStore } from "@/stores/authStore";
import { api } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, save: { load: vi.fn(), store: vi.fn(), reset: vi.fn() } }
  };
});

function login() {
  useAuthStore().user = { id: 1, username: "u", email: "u@example.com" };
}

// PrestigeConfirmModal renders via <Teleport to="body">, so its content lives
// under document.body rather than under the mounted wrapper's own element —
// query it there, and clear it between tests since Teleport keeps appending.
const body = () => new DOMWrapper(document.body);

describe("PrestigeConfirmModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the exact PhD gain", () => {
    const game = useGameStore();
    game.runTokensEarned = 4_000_000; // -> 2 PhD
    mount(PrestigeConfirmModal);
    expect(body().text()).toContain("2");
  });

  it("regression: the before/after multipliers come from the shared prestige formulas, not a re-derived copy", () => {
    // This pins the bug found in review: the modal used to hardcode
    // `1 + 0.02 * n` / `Math.min(0.5, 0.005 * n)` instead of calling
    // getProductionMultiplier/getCostMultiplier, so a balance constant change
    // would update gameStore and PrestigePanel but silently leave this
    // modal's preview showing stale numbers.
    //
    // Uses an ODD total PhD count (9, not 10) deliberately: an even count's
    // 0.5%-per-PhD discount always lands on a whole percent, which would
    // pass even with the whole-percent-rounding bug this same review round
    // found in production — see the "half-percent" test below.
    const game = useGameStore();
    game.phdCount = 7;
    game.runTokensEarned = 4_000_000; // -> 2 more PhD, total 9
    mount(PrestigeConfirmModal);

    const expectedAfterProduction = `x${getProductionMultiplier(9).toFixed(2)}`;
    const expectedAfterCost = `-${formatPercent((1 - getCostMultiplier(9)) * 100)}%`;

    expect(body().text()).toContain(expectedAfterProduction);
    expect(body().text()).toContain(expectedAfterCost);
  });

  it("half-percent regression: 1 PhD's 'before' discount shows its true 0.5%, not rounded up to 1%", () => {
    // Math.round(0.5) rounds UP in JS, so 1 PhD's true 0.5% discount used to
    // display as "-1%" — exactly double the real rate, and only ever
    // noticeable at odd PhD counts (an even count's discount always lands on
    // a whole percent, masking the bug). Verified against a live report of
    // this exact symptom: "1 PhD owned" showing "-1% Unit cost".
    const game = useGameStore();
    game.phdCount = 1;
    game.runTokensEarned = 1_000_000; // gives the modal something to prestige into
    mount(PrestigeConfirmModal);

    const costRow = body().findAll(".mult-value")[1]!.text(); // "before → after"
    expect(costRow.startsWith("-0.5%")).toBe(true);
  });

  it("cancel does not call game.prestige", async () => {
    const game = useGameStore();
    game.runTokensEarned = 4_000_000;
    mount(PrestigeConfirmModal);

    await body().find(".btn-cancel").trigger("click");

    expect(game.phdCount).toBe(0);
    expect(game.runTokensEarned).toBe(4_000_000); // untouched
  });

  it("confirm calls game.prestige exactly once, and saves it right away", async () => {
    login();
    vi.mocked(api.save.store).mockResolvedValue({
      message: "ok",
      savedAt: new Date().toISOString()
    });
    const game = useGameStore();
    game.runTokensEarned = 4_000_000;
    mount(PrestigeConfirmModal);

    await dispatchTrusted(body().find(".btn-confirm").element, "click");

    expect(game.phdCount).toBe(2);
    expect(game.runTokensEarned).toBe(0);
    expect(api.save.store).toHaveBeenCalledTimes(1);
  });

  // Prestige needs an account — even a confirm reached some other way (the
  // panel sends guests to log in instead) never prestiges a guest.
  it("a guest's confirm does not prestige and closes the dialog", async () => {
    const game = useGameStore();
    game.runTokensEarned = 4_000_000;
    mount(PrestigeConfirmModal);

    await dispatchTrusted(body().find(".btn-confirm").element, "click");

    expect(game.phdCount).toBe(0);
    expect(game.runTokensEarned).toBe(4_000_000);
    expect(api.save.store).not.toHaveBeenCalled();
  });

  it("an untrusted (synthetic) confirm click does not prestige", async () => {
    const game = useGameStore();
    game.runTokensEarned = 4_000_000;
    mount(PrestigeConfirmModal);

    await body().find(".btn-confirm").trigger("click"); // untrusted by default

    expect(game.phdCount).toBe(0);
    expect(game.runTokensEarned).toBe(4_000_000);
  });

  it("the confirm button is disabled while restricted, even with a PhD available", () => {
    const game = useGameStore();
    game.runTokensEarned = 4_000_000;
    useAntiCheatStore().isRestricted = true;
    mount(PrestigeConfirmModal);
    expect(body().find(".btn-confirm").attributes("disabled")).toBeDefined();
  });
});
