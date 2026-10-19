import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useGameStore } from "@/stores/gameStore";
import { runAutoBuy, AUTO_BUY_MAX_PER_TICK } from "@/composables/useAutoBuyer";
import { CAREER_NODES_BY_ID } from "@/utils/careerCore";

const LAB = ["habilitation", "lab.teachingAssistant", "lab.purchasingOfficer", "lab.upgradeClerk"];

function setup(ids: string[]) {
  const game = useGameStore();
  game.applyCareerState({
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
  return game;
}

const ON = { units: true, upgrades: true };

describe("runAutoBuy", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("does nothing until the nodes are bought", () => {
    const game = setup(["habilitation"]);
    game.tokens = 1e6;
    expect(runAutoBuy(game, ON)).toBe(0);
  });

  it("buys the best-value revealed unit and the cheapest affordable upgrade, capped per pass", () => {
    const game = setup(LAB);
    game.tokens = 1e6;
    game.totalTokensEarned = 1e6;
    const bought = runAutoBuy(game, ON);
    expect(bought).toBe(AUTO_BUY_MAX_PER_TICK);
    expect(game.ownedUpgrades[0]).toBe("chalk"); // the cheapest
    expect(game.unitStates.some((u) => u.owned > 0)).toBe(true);
  });

  it("respects each switch", () => {
    const game = setup(LAB);
    game.tokens = 1e6;
    game.totalTokensEarned = 1e6;
    runAutoBuy(game, { units: false, upgrades: true });
    expect(game.unitStates.every((u) => u.owned === 0)).toBe(true);
    expect(game.ownedUpgrades.length).toBeGreaterThan(0);
  });

  it("never buys while the purchase window is open or a server action is pending", () => {
    const game = setup(LAB);
    game.tokens = 1e6;
    game.totalTokensEarned = 1e6;
    game.applyCareerWindow(true, 2);
    expect(runAutoBuy(game, ON)).toBe(0);
    game.closeCareerWindowLocal();
    game.spinPending = true;
    expect(runAutoBuy(game, ON)).toBe(0);
    game.spinPending = false;
    expect(runAutoBuy(game, ON)).toBeGreaterThan(0);
  });

  it("never buys an unrevealed unit", () => {
    const game = setup(LAB);
    game.tokens = 1e9;
    game.totalTokensEarned = 0; // only alpha is revealed
    runAutoBuy(game, { units: true, upgrades: false });
    expect(game.unitStates.filter((u) => u.owned > 0).map((u) => u.id)).toEqual(["alpha"]);
  });
});
