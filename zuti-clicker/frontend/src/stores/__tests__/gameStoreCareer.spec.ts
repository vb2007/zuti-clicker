import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useGameStore, MOMENTUM_PER_CLICK, MOMENTUM_GRACE_MS } from "@/stores/gameStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { CAREER_NODES_BY_ID } from "@/utils/careerCore";
import { getPhdGain } from "@/utils/prestige";

const cost = (id: string) => CAREER_NODES_BY_ID.get(id)!.cost;
const ROOT = "habilitation";

// A guest's state with an open window and `phd` PhDs to spend.
function withWindow(phd: number) {
  const game = useGameStore();
  game.phdCount = phd;
  game.applyCareerWindow(true, 1);
  return game;
}

function own(game: ReturnType<typeof useGameStore>, ids: string[]) {
  game.applyCareerState({
    career: {
      windowOpen: false,
      windowId: 1,
      phdInvested: 0,
      nodes: ids.map((nodeId) => ({ nodeId, cost: cost(nodeId), refundable: false }))
    }
  });
}

function unit(game: ReturnType<typeof useGameStore>, id: string) {
  return game.unitStates.find((u) => u.id === id)!;
}

describe("gameStore — Academic Career (local rules)", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("buys only inside an open window, with the prerequisite, at the catalog price", () => {
    const game = useGameStore();
    game.phdCount = 50;
    expect(game.buyCareerNodeLocal(ROOT)).toBe(false); // no window
    game.applyCareerWindow(true, 1);
    expect(game.buyCareerNodeLocal("research.labAccess")).toBe(false); // root not owned
    expect(game.buyCareerNodeLocal(ROOT)).toBe(true);
    expect(game.phdCount).toBe(50 - cost(ROOT));
    expect(game.careerNodes).toEqual([{ nodeId: ROOT, cost: cost(ROOT), refundable: true }]);
    expect(game.buyCareerNodeLocal(ROOT)).toBe(false); // already owned
    expect(game.phdInvested).toBe(cost(ROOT));
    expect(game.phdTotal).toBe(50);
  });

  it("refuses an unaffordable node and changes nothing", () => {
    const game = withWindow(0);
    expect(game.buyCareerNodeLocal(ROOT)).toBe(false);
    expect(game.careerNodes).toEqual([]);
    expect(game.phdCount).toBe(0);
  });

  it("refunds cascade to in-window descendants and previews the same total", () => {
    const game = withWindow(100);
    for (const id of [ROOT, "research.labAccess", "research.grantWriting.1"]) {
      expect(game.buyCareerNodeLocal(id)).toBe(true);
    }
    const preview = game.careerRefundPreview("research.labAccess")!;
    expect(preview.nodeIds).toEqual(["research.labAccess", "research.grantWriting.1"]);
    expect(preview.phd).toBe(cost("research.labAccess") + cost("research.grantWriting.1"));
    expect(game.refundCareerNodeLocal("research.labAccess")).toBe(true);
    expect(game.careerNodeIds).toEqual([ROOT]);
    expect(game.phdCount).toBe(100 - cost(ROOT));
  });

  it("nothing is refundable once the window closes", () => {
    const game = withWindow(100);
    game.buyCareerNodeLocal(ROOT);
    game.closeCareerWindowLocal();
    expect(game.careerRefundPreview(ROOT)).toBeNull();
    expect(game.refundCareerNodeLocal(ROOT)).toBe(false);
    expect(game.careerNodes[0]!.refundable).toBe(false);
  });

  it("a pending server action (spin or career change) refuses purchases and prestige", () => {
    const game = withWindow(100);
    game.tokens = 1e9;
    game.runTokensEarned = 4e6;
    game.careerPending = true;
    expect(game.buyCareerNodeLocal(ROOT)).toBe(false);
    expect(game.buyUnit("alpha", 1)).toBe(false);
    expect(game.buyUpgrade("chalk")).toBe(false);
    expect(game.prestige()).toBe(0);
    game.careerPending = false;
    expect(game.buyUnit("alpha", 1)).toBe(true);
  });

  it("restricted accounts can't change the tree", () => {
    const game = withWindow(100);
    useAntiCheatStore().applyServerResult({
      isRestricted: true,
      restrictedUntil: new Date(Date.now() + 60_000).toISOString(),
      strikeCount: 1
    });
    expect(game.buyCareerNodeLocal(ROOT)).toBe(false);
  });
});

describe("gameStore — Academic Career effects", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("production nodes multiply tokens/sec (the root: +10%)", () => {
    const game = useGameStore();
    unit(game, "alpha").owned = 10;
    const before = game.tokensPerSecond;
    own(game, [ROOT]);
    expect(game.tokensPerSecond).toBeCloseTo(before * 1.1, 10);
  });

  it("per-unit nodes multiply only their unit", () => {
    const game = useGameStore();
    unit(game, "alpha").owned = 10;
    unit(game, "beta").owned = 10;
    const base = game.baseTokensPerSecond;
    own(game, [ROOT, "research.labAccess", "research.researchGroup", "research.alphaStudies.1"]);
    expect(game.baseTokensPerSecond).toBeCloseTo(base + 10 * 0.3 * 0.5, 10);
  });

  it("the per-PhD bonus strengthens what held PhDs give", () => {
    const game = useGameStore();
    game.phdCount = 10;
    expect(game.productionMultiplier).toBeCloseTo(1.2, 10);
    own(game, [ROOT, "thesis.doctoralSchool", "thesis.academicPrestige"]);
    expect(game.productionMultiplier).toBeCloseTo(1 + 0.022 * 10, 10);
  });

  it("unit and upgrade discounts lower prices", () => {
    const game = useGameStore();
    const unitBefore = game.getBuyCost("alpha", 1);
    own(game, [ROOT, "administration.departmentBudget"]);
    expect(game.getBuyCost("alpha", 1)).toBeCloseTo(unitBefore * 0.95, 10);
    expect(game.getUpgradeCost("chalk")).toBe(150);
    own(game, [
      ROOT,
      "administration.departmentBudget",
      "administration.seedFunding",
      "administration.tenureTrack",
      "administration.endowment",
      "administration.bulkPurchasing"
    ]);
    expect(game.getUpgradeCost("chalk")).toBeCloseTo(135, 10);
    game.tokens = 135;
    expect(game.buyUpgrade("chalk")).toBe(true);
    expect(game.tokens).toBeCloseTo(0, 10);
  });

  it("a PhD-gain node scales prestige gain, with an exact floor", () => {
    const game = useGameStore();
    game.runTokensEarned = 400e6; // base gain 20
    expect(game.phdGain).toBe(20);
    own(game, [ROOT, "thesis.doctoralSchool"]); // +10%
    expect(game.phdGain).toBe(22);
  });

  it("regression: Teaching Assistant income is credited by tick, never counted as clicks", () => {
    const game = useGameStore();
    const recordClick = vi.spyOn(useAntiCheatStore(), "recordClick");
    own(game, [ROOT, "lab.teachingAssistant"]); // 1 auto-click/s, worth a base click
    expect(game.autoClickIncome).toBeCloseTo(1, 10);
    game.tick(2);
    expect(game.tokens).toBeCloseTo(2, 10);
    expect(game.totalTokensEarned).toBeCloseTo(2, 10);
    expect(game.totalClicks).toBe(0);
    expect(game.runClicks).toBe(0);
    expect(recordClick).not.toHaveBeenCalled();
  });

  it("Lecture momentum builds with clicks and drains after a pause", () => {
    vi.useFakeTimers();
    try {
      const game = useGameStore();
      own(game, [ROOT, "lecturing.lecturer", "lecturing.lectureMomentum"]); // x2 click, +25% cap
      game.clickToken();
      expect(game.momentum).toBeCloseTo(MOMENTUM_PER_CLICK, 10);
      // The next click is worth x2 x (1 + 0.25 x meter).
      const { earned } = game.clickToken();
      expect(earned).toBeCloseTo(2 * (1 + 0.25 * MOMENTUM_PER_CLICK * 2), 10);
      game.tick(0.5); // within the grace period
      expect(game.momentum).toBeCloseTo(MOMENTUM_PER_CLICK * 2, 10);
      vi.advanceTimersByTime(MOMENTUM_GRACE_MS + 1);
      game.tick(1);
      expect(game.momentum).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("without the momentum node, clicking builds no meter", () => {
    const game = useGameStore();
    game.clickToken();
    expect(game.momentum).toBe(0);
  });

  it("Crit Storm adds its crit chance while active", () => {
    const game = useGameStore();
    expect(game.critChance).toBe(0);
    game.grantBooster("critStorm", 30_000);
    expect(game.critChance).toBeCloseTo(0.5, 10);
  });

  it("booster potency strengthens the active booster", () => {
    const game = useGameStore();
    game.grantBooster("frenzy", 60_000);
    expect(game.boosterProductionMultiplier).toBe(7);
    own(game, [ROOT, "conferences.conferenceSeason", "conferences.frenzyPotency.1"]);
    expect(game.boosterProductionMultiplier).toBeCloseTo(7.6, 10);
  });
});

describe("gameStore — prestige with the Academic Career", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function readyToPrestige() {
    const game = useGameStore();
    game.runTokensEarned = 4e6;
    game.totalTokensEarned = 4e6;
    game.tokens = 1e6;
    unit(game, "alpha").owned = 41;
    unit(game, "beta").owned = 7;
    game.ownedUpgrades = ["chalk", "firmHandshake", "conferenceBadge"];
    return game;
  }

  it("without a tree it resets exactly as before", () => {
    const game = readyToPrestige();
    expect(game.prestige()).toBe(2);
    expect(game.tokens).toBe(0);
    expect(game.unitStates.every((u) => u.owned === 0)).toBe(true);
    expect(game.ownedUpgrades).toEqual([]);
  });

  it("keeps floor(owned x share) units, kept upgrade families and starts with the fund", () => {
    const game = readyToPrestige();
    own(game, [
      ROOT,
      "administration.departmentBudget",
      "administration.seedFunding", // 1,000 start fund
      "administration.tenureTrack", // keep 5%
      "administration.endowment", // keep "flat"
      "administration.archives.1", // keep "multiplier"
      "administration.archives.2",
      "administration.archives.3",
      "administration.archives.4" // keep "booster"
    ]);
    game.prestige();
    expect(unit(game, "alpha").owned).toBe(2); // floor(41 x 0.05)
    expect(unit(game, "beta").owned).toBe(0); // floor(7 x 0.05)
    expect(game.ownedUpgrades).toEqual(["chalk", "firmHandshake", "conferenceBadge"]);
    // The fund is money to spend, not earnings.
    expect(game.tokens).toBe(1000);
    expect(game.runTokensEarned).toBe(0);
    expect(game.totalTokensEarned).toBe(4e6);
  });

  it("opens a new window and makes the previous window's purchases permanent", () => {
    const game = withWindow(100);
    game.buyCareerNodeLocal(ROOT);
    game.runTokensEarned = 4e6;
    game.prestige();
    expect(game.careerWindowOpen).toBe(true);
    expect(game.careerWindowId).toBe(2);
    expect(game.careerNodes[0]!.refundable).toBe(false);
  });

  it("a guest's tree is forfeited at login: nodes refunded, bonus PhDs removed", () => {
    const game = withWindow(100);
    game.buyCareerNodeLocal(ROOT);
    game.buyCareerNodeLocal("thesis.doctoralSchool");
    game.runTokensEarned = 400e6; // base 20, +10% -> 22
    expect(game.prestige()).toBe(22);
    expect(getPhdGain(0)).toBe(0);
    const held = game.phdCount;
    expect(game.forfeitGuestCareer()).toBe(true);
    expect(game.careerNodes).toEqual([]);
    expect(game.careerWindowOpen).toBe(false);
    // 100 + 22 earned, minus the 2 the guest-only bonus added.
    expect(game.phdCount).toBe(held + cost(ROOT) + cost("thesis.doctoralSchool") - 2);
    expect(game.phdCount).toBe(120);
    expect(game.forfeitGuestCareer()).toBe(false);
  });
});

describe("gameStore — the game waits while the purchase window is open", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("regression: no ticks and no clicks until the window closes", () => {
    const game = useGameStore();
    unit(game, "alpha").owned = 10;
    game.applyCareerWindow(true, 1);
    game.tick(10);
    expect(game.clickToken().earned).toBe(0);
    expect(game.tokens).toBe(0);
    expect(game.runSeconds).toBe(0);
    expect(game.runClicks).toBe(0);
    game.closeCareerWindowLocal();
    game.tick(1);
    expect(game.runSeconds).toBe(1);
    expect(game.tokens).toBeGreaterThan(0);
  });

  it("a prestige pauses the new run straight away (the window opens with it)", () => {
    const game = useGameStore();
    game.runTokensEarned = 4e6;
    unit(game, "alpha").owned = 40;
    own(game, [
      ROOT,
      "administration.departmentBudget",
      "administration.seedFunding",
      "administration.tenureTrack"
    ]);
    game.prestige();
    game.tick(30);
    expect(game.runSeconds).toBe(0);
    expect(game.runTokensEarned).toBe(0);
  });
});

describe("gameStore — Academic Career persistence", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("loads the server's tree and window, ignoring unknown node ids", () => {
    const game = useGameStore();
    game.loadFromSave({
      tokens: 0,
      totalTokensEarned: 0,
      totalClicks: 0,
      elapsedSeconds: 0,
      units: [],
      phdCount: 7,
      career: {
        windowOpen: true,
        windowId: 3,
        phdInvested: 1,
        nodes: [
          { nodeId: ROOT, cost: 1, refundable: true },
          { nodeId: "retired.node", cost: 5, refundable: false }
        ]
      }
    });
    expect(game.careerNodes).toEqual([{ nodeId: ROOT, cost: 1, refundable: true }]);
    expect(game.careerWindowOpen).toBe(true);
    expect(game.careerWindowId).toBe(3);
  });

  it("a save from an API without the career is an empty tree with no window", () => {
    const game = withWindow(10);
    game.buyCareerNodeLocal(ROOT);
    game.loadFromSave({
      tokens: 0,
      totalTokensEarned: 0,
      totalClicks: 0,
      elapsedSeconds: 0,
      units: []
    });
    expect(game.careerNodes).toEqual([]);
    expect(game.careerWindowOpen).toBe(false);
  });

  it("PUT /save never carries the tree (it changes only through POST /career/*)", () => {
    const game = withWindow(10);
    game.buyCareerNodeLocal(ROOT);
    const payload = game.toSavePayload() as unknown as Record<string, unknown>;
    expect(Object.keys(payload).some((k) => k.toLowerCase().includes("career"))).toBe(false);
  });

  it("hardReset clears the tree and the window", () => {
    const game = withWindow(10);
    game.buyCareerNodeLocal(ROOT);
    game.hardReset();
    expect(game.careerNodes).toEqual([]);
    expect(game.careerWindowOpen).toBe(false);
    expect(game.careerWindowId).toBe(0);
  });
});
