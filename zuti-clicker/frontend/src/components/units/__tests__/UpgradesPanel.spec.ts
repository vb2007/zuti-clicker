import { describe, it, expect, beforeEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount } from "@vue/test-utils";
import UpgradesPanel from "@/components/units/UpgradesPanel.vue";
import { useGameStore } from "@/stores/gameStore";

describe("UpgradesPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("shows the click-only clarification note", () => {
    const wrapper = mount(UpgradesPanel);
    expect(wrapper.find(".click-only-note").exists()).toBe(true);
    expect(wrapper.find(".click-only-note").text()).toContain("click");
  });

  it("groups the buy grid into 4 families, each with a subtitle (not 5)", () => {
    const game = useGameStore();
    // High enough to reveal at least one upgrade in every group.
    game.totalTokensEarned = 400_000_000;
    const wrapper = mount(UpgradesPanel);
    const groups = wrapper.findAll(".upgrade-group");
    expect(groups.length).toBe(4);
    for (const group of groups) {
      expect(group.find(".group-desc").exists()).toBe(true);
      expect(group.find(".group-desc").text().length).toBeGreaterThan(0);
    }
  });

  it("shows the empty hint when nothing is revealed or owned yet", () => {
    const wrapper = mount(UpgradesPanel);
    expect(wrapper.find(".upgrades-empty").exists()).toBe(true);
  });

  describe("owned strip", () => {
    it("groups owned upgrades with a live aggregate per group", () => {
      const game = useGameStore();
      game.tokens = 10_000;
      game.totalTokensEarned = 10_000;
      game.buyUpgrade("chalk"); // flat +1
      game.buyUpgrade("firmHandshake"); // multiplier x2

      const wrapper = mount(UpgradesPanel);
      const group = wrapper.findAll(".owned-group").find((g) => g.text().includes("Click Value"));
      expect(group).toBeTruthy();
      expect(group!.find(".owned-group-aggregate").text()).toBe("+1 · ×2");
    });

    it("half-percent regression: a single synergy tier's owned effect prints 0.5%, not 1%", () => {
      const game = useGameStore();
      game.tokens = 300_000;
      game.totalTokensEarned = 300_000;
      game.buyUpgrade("lectureNotes"); // cost 250_000

      const wrapper = mount(UpgradesPanel);
      const group = wrapper.findAll(".owned-group").find((g) => g.text().includes("Income Synergy"));
      expect(group!.find(".owned-group-aggregate").text()).toBe("+0.5% of income");
      const chipEffect = group!.find(".owned-chip-effect").text();
      expect(chipEffect).toBe("+0.5%");
    });

    it("marks every owned crit tier except the highest-cost one as superseded", () => {
      const game = useGameStore();
      game.tokens = 400_000_000;
      game.totalTokensEarned = 400_000_000;
      game.buyUpgrade("luckyGuess"); // cost 80_000
      game.buyUpgrade("peerReview"); // cost 300_000_000 -- higher, actually in effect

      const wrapper = mount(UpgradesPanel);
      const chips = wrapper.findAll(".owned-chip");
      const luckyGuess = chips.find((c) => c.text().includes("Lucky Guess"));
      const peerReview = chips.find((c) => c.text().includes("Peer Review"));

      expect(luckyGuess!.classes()).toContain("superseded");
      expect(luckyGuess!.find(".superseded-tag").exists()).toBe(true);
      expect(peerReview!.classes()).not.toContain("superseded");
      expect(peerReview!.find(".superseded-tag").exists()).toBe(false);
    });
  });
});
