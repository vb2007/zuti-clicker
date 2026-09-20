import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useGameStore } from "@/stores/gameStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { UNIT_DEFINITIONS } from "@/utils/gameConstants";

describe("gameStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("initial state", () => {
    const game = useGameStore();
    expect(game.tokens).toBe(0);
    expect(game.totalTokensEarned).toBe(0);
    expect(game.totalClicks).toBe(0);
    expect(game.elapsedSeconds).toBe(0);
    expect(game.runTokensEarned).toBe(0);
    expect(game.runClicks).toBe(0);
    expect(game.runSeconds).toBe(0);
    expect(game.phdCount).toBe(0);
    expect(game.prestigeCount).toBe(0);
    expect(game.unitStates).toHaveLength(UNIT_DEFINITIONS.length);
    expect(game.unitStates.every((u) => u.owned === 0)).toBe(true);
  });

  describe("clickToken / tick update lifetime and run counters together", () => {
    it("clickToken adds to tokens, totalTokensEarned, and runTokensEarned; increments both click counters", () => {
      const game = useGameStore();
      const { earned, crit } = game.clickToken();
      expect(earned).toBe(1);
      expect(crit).toBe(false); // 0% crit chance with no crit upgrades owned
      expect(game.tokens).toBe(1);
      expect(game.totalTokensEarned).toBe(1);
      expect(game.runTokensEarned).toBe(1);
      expect(game.totalClicks).toBe(1);
      expect(game.runClicks).toBe(1);
    });

    it("clickToken reflects the production multiplier from banked PhDs", () => {
      const game = useGameStore();
      game.phdCount = 50; // multiplier = 1 + 0.02*50 = 2
      const { earned } = game.clickToken();
      expect(earned).toBe(2);
      expect(game.tokens).toBe(2);
      expect(game.totalTokensEarned).toBe(2);
      expect(game.runTokensEarned).toBe(2);
    });

    it("tick with no units changes nothing but elapsed/run seconds", () => {
      const game = useGameStore();
      game.tick(1);
      expect(game.tokens).toBe(0);
      expect(game.elapsedSeconds).toBe(1);
      expect(game.runSeconds).toBe(1);
    });

    it("tick production honours owned units and the multiplier", () => {
      const game = useGameStore();
      game.tokens = 1000;
      game.buyUnit("alpha", 10); // baseProduction 0.3 * 10 = 3/s
      game.tokens = 0; // isolate tick's effect from the purchase cost

      game.tick(1);
      expect(game.tokens).toBeCloseTo(3, 9);
      expect(game.baseTokensPerSecond).toBeCloseTo(3, 9);

      game.phdCount = 50; // multiplier = 2
      game.tick(1);
      expect(game.tokens).toBeCloseTo(3 + 6, 9);
      expect(game.baseTokensPerSecond).toBeCloseTo(3, 9); // unmultiplied stays 3
    });
  });

  describe("costs honour the discount", () => {
    it("getBuyCost is cheaper with PhDs banked", () => {
      const game = useGameStore();
      game.phdCount = 100; // cost multiplier capped at 0.5
      expect(game.getBuyCost("alpha", 1)).toBe(5);
    });

    it("canAfford reflects the discounted cost", () => {
      const game = useGameStore();
      game.phdCount = 100;
      game.tokens = 5;
      expect(game.canAfford("alpha", 1)).toBe(true);
      game.tokens = 4.99;
      expect(game.canAfford("alpha", 1)).toBe(false);
    });

    it("buyUnit never leaves tokens negative across all multipliers", () => {
      const game = useGameStore();
      game.tokens = 50;
      for (const multiplier of [1, 5, 10, 50, "max"] as const) {
        game.buyUnit("alpha", multiplier);
        expect(game.tokens).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("prestige()", () => {
    it("is refused below the threshold and leaves the store untouched", () => {
      const game = useGameStore();
      game.runTokensEarned = 999_999;
      game.tokens = 42;
      game.buyUnit("alpha", 1);
      const before = JSON.parse(JSON.stringify(game.$state));

      const gained = game.prestige();

      expect(gained).toBe(0);
      expect(JSON.parse(JSON.stringify(game.$state))).toEqual(before);
    });

    it("banks the correct PhD count, read before the reset (ordering hazard)", () => {
      const game = useGameStore();
      game.runTokensEarned = 4_000_000; // -> 2 PhD
      const gained = game.prestige();
      expect(gained).toBe(2);
      expect(game.phdCount).toBe(2);
      expect(game.prestigeCount).toBe(1);
    });

    it("resets exactly the run/token/unit fields", () => {
      const game = useGameStore();
      game.tokens = 500;
      game.runTokensEarned = 1_000_000;
      game.runClicks = 40;
      game.runSeconds = 120;
      game.buyUnit("alpha", 5);

      game.prestige();

      expect(game.tokens).toBe(0);
      expect(game.runTokensEarned).toBe(0);
      expect(game.runClicks).toBe(0);
      expect(game.runSeconds).toBe(0);
      expect(game.unitStates.every((u) => u.owned === 0)).toBe(true);
    });

    it("preserves lifetime totals exactly", () => {
      const game = useGameStore();
      game.totalTokensEarned = 12_345_678;
      game.totalClicks = 999;
      game.elapsedSeconds = 3600;
      game.runTokensEarned = 1_000_000;

      game.prestige();

      expect(game.totalTokensEarned).toBe(12_345_678);
      expect(game.totalClicks).toBe(999);
      expect(game.elapsedSeconds).toBe(3600);
    });

    it("stacks across multiple prestiges", () => {
      const game = useGameStore();
      game.runTokensEarned = 4_000_000;
      game.prestige();
      game.runTokensEarned = 4_000_000;
      game.prestige();
      expect(game.phdCount).toBe(4);
      expect(game.prestigeCount).toBe(2);
    });

    it("production and cost multipliers reflect the new PhD count after prestiging", () => {
      const game = useGameStore();
      game.runTokensEarned = 100_000_000; // -> 10 PhD
      game.prestige();
      expect(game.tokensPerClick).toBeCloseTo(1.2, 9);
      expect(game.getBuyCost("alpha", 1)).toBeCloseTo(10 * (1 - 0.05), 9);
    });

    it("isUnitRevealed survives a prestige (lifetime-based reveal is unaffected)", () => {
      const game = useGameStore();
      game.totalTokensEarned = 400_000_000; // reveals theta (baseCost 330M * 0.1)
      expect(game.isUnitRevealed("theta")).toBe(true);
      game.runTokensEarned = 1_000_000;
      game.prestige();
      expect(game.isUnitRevealed("theta")).toBe(true);
    });
  });

  describe("hardReset()", () => {
    it("zeroes everything, including PhDs and prestige count", () => {
      const game = useGameStore();
      game.tokens = 5;
      game.totalTokensEarned = 100;
      game.totalClicks = 10;
      game.elapsedSeconds = 60;
      game.phdCount = 7;
      game.prestigeCount = 2;
      game.buyUnit("alpha", 1);

      game.hardReset();

      expect(game.tokens).toBe(0);
      expect(game.totalTokensEarned).toBe(0);
      expect(game.totalClicks).toBe(0);
      expect(game.elapsedSeconds).toBe(0);
      expect(game.phdCount).toBe(0);
      expect(game.prestigeCount).toBe(0);
      expect(game.unitStates.every((u) => u.owned === 0)).toBe(true);
    });
  });

  describe("save round-trip", () => {
    it("loadFromSave(toSavePayload()) is a fixed point", () => {
      const game = useGameStore();
      game.tokens = 123.45;
      game.totalTokensEarned = 999;
      game.totalClicks = 12;
      game.elapsedSeconds = 45;
      game.phdCount = 3;
      game.prestigeCount = 1;
      game.runTokensEarned = 500;
      game.runClicks = 5;
      game.runSeconds = 10;
      game.buyUnit("alpha", 1);

      const payload = game.toSavePayload();
      game.hardReset();
      game.loadFromSave(payload);

      expect(game.toSavePayload()).toEqual(payload);
    });

    it("a legacy save (no run/prestige fields) seeds run totals from lifetime totals", () => {
      const game = useGameStore();
      game.loadFromSave({
        tokens: 10,
        totalTokensEarned: 5_000_000_000,
        totalClicks: 200,
        elapsedSeconds: 900,
        units: []
      });

      expect(game.phdCount).toBe(0);
      expect(game.prestigeCount).toBe(0);
      expect(game.runTokensEarned).toBe(5_000_000_000);
      expect(game.runClicks).toBe(200);
      expect(game.runSeconds).toBe(900);
    });

    it("a v2 save with a genuine zero run value is preserved, not re-seeded (?? vs ||)", () => {
      const game = useGameStore();
      game.loadFromSave({
        tokens: 0,
        totalTokensEarned: 5_000_000_000,
        totalClicks: 200,
        elapsedSeconds: 900,
        runTokensEarned: 0,
        runClicks: 0,
        runSeconds: 0,
        phdCount: 7,
        prestigeCount: 3,
        units: []
      });

      expect(game.runTokensEarned).toBe(0);
      expect(game.runClicks).toBe(0);
      expect(game.runSeconds).toBe(0);
      expect(game.phdCount).toBe(7);
    });

    it("an unknown unitId in the save is ignored, and an absent one resets to 0", () => {
      const game = useGameStore();
      game.tokens = 1000;
      game.buyUnit("beta", 1);
      expect(game.unitStates.find((u) => u.id === "beta")?.owned).toBe(1); // sanity: purchase worked
      game.loadFromSave({
        tokens: 0,
        totalTokensEarned: 0,
        totalClicks: 0,
        elapsedSeconds: 0,
        units: [
          { unitId: "alpha", owned: 5 },
          { unitId: "not-a-real-unit", owned: 99 }
        ]
      });

      expect(game.unitStates.find((u) => u.id === "alpha")?.owned).toBe(5);
      expect(game.unitStates.find((u) => u.id === "beta")?.owned).toBe(0);
    });
  });

  describe("isUnitRevealed", () => {
    it("alpha is always revealed", () => {
      const game = useGameStore();
      expect(game.isUnitRevealed("alpha")).toBe(true);
    });

    it("beta reveals at 10% of its base cost (10)", () => {
      const game = useGameStore();
      game.totalTokensEarned = 9;
      expect(game.isUnitRevealed("beta")).toBe(false);
      game.totalTokensEarned = 10;
      expect(game.isUnitRevealed("beta")).toBe(true);
    });

    it("theta reveal threshold is unaffected by the cost discount", () => {
      const game = useGameStore();
      game.phdCount = 100;
      game.totalTokensEarned = 32_999_999;
      expect(game.isUnitRevealed("theta")).toBe(false);
      game.totalTokensEarned = 33_000_000;
      expect(game.isUnitRevealed("theta")).toBe(true);
    });
  });

  describe("upgrades", () => {
    it("chalk is revealed at 25% of its 150-token cost", () => {
      const game = useGameStore();
      game.totalTokensEarned = 37; // 150 * 0.25 = 37.5
      expect(game.isUpgradeRevealed("chalk")).toBe(false);
      game.totalTokensEarned = 37.5;
      expect(game.isUpgradeRevealed("chalk")).toBe(true);
    });

    it("buyUpgrade deducts cost once and marks it owned; a second buy is refused", () => {
      const game = useGameStore();
      game.tokens = 150;
      expect(game.buyUpgrade("chalk")).toBe(true);
      expect(game.tokens).toBe(0);
      expect(game.isUpgradeOwned("chalk")).toBe(true);

      game.tokens = 150;
      expect(game.buyUpgrade("chalk")).toBe(false); // already owned
      expect(game.tokens).toBe(150); // untouched
    });

    it("buyUpgrade is refused (and mutates nothing) when unaffordable or unknown", () => {
      const game = useGameStore();
      game.tokens = 100;
      const before = JSON.parse(JSON.stringify(game.$state));

      expect(game.buyUpgrade("chalk")).toBe(false); // costs 150, only have 100
      expect(game.buyUpgrade("not-a-real-upgrade")).toBe(false);

      expect(JSON.parse(JSON.stringify(game.$state))).toEqual(before);
    });

    it("owned flat/multiplier/synergy upgrades raise tokensPerClick", () => {
      const game = useGameStore();
      const baseline = game.tokensPerClick;
      game.ownedUpgrades = ["chalk", "firmHandshake"];
      // (1 + 1) * 2 = 4, vs baseline of 1
      expect(game.tokensPerClick).toBeCloseTo(4, 9);
      expect(game.tokensPerClick).toBeGreaterThan(baseline);
    });

    it("a crit roll multiplies the click by the best owned crit tier", () => {
      const game = useGameStore();
      game.ownedUpgrades = ["luckyGuess"]; // 5% chance, x3
      const originalRandom = Math.random;
      try {
        Math.random = () => 0; // forces a crit (0 < 0.05)
        const { earned, crit } = game.clickToken();
        expect(crit).toBe(true);
        expect(earned).toBeCloseTo(3, 9); // tokensPerClick(1) * critMultiplier(3)
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  describe("boosters", () => {
    it("grantBooster adds an active entry that boosts production", () => {
      const game = useGameStore();
      game.tokens = 1000;
      game.buyUnit("alpha", 10); // 3/s baseline
      const before = game.tokensPerSecond;

      game.grantBooster("frenzy", 60_000);
      expect(game.tokensPerSecond).toBeCloseTo(before * 7, 9);
    });

    it("reclaiming an already-active booster refreshes its timer instead of adding a second entry", () => {
      const game = useGameStore();
      game.grantBooster("frenzy", 1000);
      game.grantBooster("frenzy", 60_000);
      expect(game.activeBoosters).toHaveLength(1);
      expect(game.activeBoosters[0]!.expiresAt).toBeGreaterThan(Date.now() + 50_000);
    });

    it("boosterProductionActive/boosterClickActive/boosterCostReductionActive reflect which kind is active", () => {
      const game = useGameStore();
      expect(game.boosterProductionActive).toBe(false);
      expect(game.boosterClickActive).toBe(false);
      expect(game.boosterCostReductionActive).toBe(false);

      game.grantBooster("frenzy", 60_000);
      expect(game.boosterProductionActive).toBe(true);
      expect(game.boosterClickActive).toBe(false);
      expect(game.boosterCostReductionActive).toBe(false);

      game.grantBooster("clearance", 60_000);
      expect(game.boosterCostReductionActive).toBe(true);
    });

    it("clearance discounts unit costs on top of the PhD discount", () => {
      const game = useGameStore();
      game.phdCount = 100; // 50% PhD discount alone
      const costWithoutBooster = game.getBuyCost("alpha", 1);

      game.grantBooster("clearance", 60_000); // additional -25%
      const costWithBooster = game.getBuyCost("alpha", 1);

      expect(costWithBooster).toBeCloseTo(costWithoutBooster * 0.75, 9);
    });

    it("an expired booster is swept out by tick() and its multiplier reverts", () => {
      const game = useGameStore();
      game.grantBooster("frenzy", -1); // already expired
      game.tick(0.001);
      expect(game.activeBoosters).toHaveLength(0);
      expect(game.boosterProductionMultiplier).toBe(1);
    });

    it("prestige() does NOT clear active boosters (a timed event, not progression)", () => {
      const game = useGameStore();
      game.grantBooster("frenzy", 60_000);
      game.runTokensEarned = 4_000_000;
      game.prestige();
      expect(game.activeBoosters).toHaveLength(1);
    });

    it("prestige() DOES clear owned upgrades", () => {
      const game = useGameStore();
      game.tokens = 150;
      game.buyUpgrade("chalk");
      game.runTokensEarned = 4_000_000;
      game.prestige();
      expect(game.ownedUpgrades).toEqual([]);
    });

    it("hardReset() clears both owned upgrades and active boosters", () => {
      const game = useGameStore();
      game.tokens = 150;
      game.buyUpgrade("chalk");
      game.grantBooster("frenzy", 60_000);

      game.hardReset();

      expect(game.ownedUpgrades).toEqual([]);
      expect(game.activeBoosters).toEqual([]);
    });
  });

  describe("upgrades/boosters in the save round-trip", () => {
    it("toSavePayload includes owned upgrades; loadFromSave restores them", () => {
      const game = useGameStore();
      game.tokens = 150;
      game.buyUpgrade("chalk");

      const payload = game.toSavePayload();
      expect(payload.upgrades).toEqual(["chalk"]);

      game.hardReset();
      game.loadFromSave(payload);
      expect(game.ownedUpgrades).toEqual(["chalk"]);
    });

    it("a legacy save with no upgrades field defaults to an empty list (?? not ||)", () => {
      const game = useGameStore();
      game.loadFromSave({
        tokens: 0,
        totalTokensEarned: 0,
        totalClicks: 0,
        elapsedSeconds: 0,
        units: []
      });
      expect(game.ownedUpgrades).toEqual([]);
    });

    it("loadFromSave restores an active booster's remaining time anchored to this client's clock", () => {
      const game = useGameStore();
      game.loadFromSave({
        tokens: 0,
        totalTokensEarned: 0,
        totalClicks: 0,
        elapsedSeconds: 0,
        units: [],
        activeBoosters: [{ boosterId: "frenzy", remainingMs: 30_000 }]
      });
      expect(game.activeBoosters).toHaveLength(1);
      expect(game.activeBoosters[0]!.expiresAt).toBeGreaterThan(Date.now() + 25_000);
      expect(game.activeBoosters[0]!.expiresAt).toBeLessThanOrEqual(Date.now() + 30_000);
    });

    it("toSavePayload never includes activeBoosters — that state is server/local-only, never asserted via PUT /save", () => {
      const game = useGameStore();
      game.grantBooster("frenzy", 60_000);
      const payload = game.toSavePayload();
      expect("activeBoosters" in payload).toBe(false);
    });
  });

  describe("anti-cheat restriction gate", () => {
    function restrict(): void {
      const antiCheat = useAntiCheatStore();
      antiCheat.isRestricted = true;
    }

    it("clickToken is a no-op while restricted", () => {
      const game = useGameStore();
      restrict();
      const { earned, crit } = game.clickToken();
      expect(earned).toBe(0);
      expect(crit).toBe(false);
      expect(game.tokens).toBe(0);
      expect(game.totalClicks).toBe(0);
    });

    it("buyUnit is a no-op while restricted, even if otherwise affordable", () => {
      const game = useGameStore();
      game.tokens = 1_000_000;
      restrict();
      expect(game.buyUnit("alpha", 1)).toBe(false);
      expect(game.unitStates.find((u) => u.id === "alpha")?.owned).toBe(0);
    });

    it("buyUpgrade is a no-op while restricted, even if otherwise affordable", () => {
      const game = useGameStore();
      game.tokens = 1_000_000;
      restrict();
      expect(game.buyUpgrade("chalk")).toBe(false);
      expect(game.isUpgradeOwned("chalk")).toBe(false);
    });

    it("tick (idle income) is a no-op while restricted", () => {
      const game = useGameStore();
      game.unitStates[0]!.owned = 10;
      restrict();
      game.tick(1);
      expect(game.tokens).toBe(0);
      expect(game.elapsedSeconds).toBe(0);
    });

    it("prestige is a no-op while restricted, even with enough runTokensEarned", () => {
      const game = useGameStore();
      game.runTokensEarned = 4_000_000;
      restrict();
      expect(game.prestige()).toBe(0);
      expect(game.phdCount).toBe(0);
    });

    it("everything works normally again once no longer restricted", () => {
      const game = useGameStore();
      const antiCheat = useAntiCheatStore();
      antiCheat.isRestricted = true;
      game.clickToken();
      expect(game.tokens).toBe(0);
      antiCheat.isRestricted = false;
      const { earned } = game.clickToken();
      expect(earned).toBeGreaterThan(0);
      expect(game.tokens).toBeGreaterThan(0);
    });
  });
});
