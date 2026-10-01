import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, flushPromises, DOMWrapper, type VueWrapper } from "@vue/test-utils";
import UpgraderModal from "@/components/upgrader/UpgraderModal.vue";
import { useGameStore } from "@/stores/gameStore";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { api } from "@/lib/api";
import { multiplierToSlider } from "@/utils/upgrader";
import { dispatchTrusted } from "@/__tests__/testEvents";

// Only `api` is replaced; the real ApiError / isStaleSaveError stay.
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

describe("UpgraderModal", () => {
  let wrapper: VueWrapper | null = null;
  const body = () => new DOMWrapper(document.body);
  const q = (sel: string) => body().find(sel);
  const text = (sel: string) => q(sel).text();

  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = "";
    vi.mocked(api.save.store).mockReset().mockResolvedValue({
      message: "ok",
      savedAt: new Date().toISOString()
    });
    vi.mocked(api.upgrader.spin).mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  // The roll a guest's spin uses: any draw below PPM maps to itself.
  function stubRoll(rollPpm: number) {
    vi.spyOn(crypto, "getRandomValues").mockImplementation(((arr: Uint32Array) => {
      arr[0] = rollPpm;
      return arr;
    }) as typeof crypto.getRandomValues);
  }

  async function open(phd = 250) {
    const game = useGameStore();
    game.phdCount = phd;
    game.prestigeCount = 3;
    wrapper = mount(UpgraderModal, { attachTo: document.body });
    useUiStore().upgraderOpen = true;
    await nextTick();
    await nextTick();
    return game;
  }

  async function click(sel: string) {
    await dispatchTrusted(q(sel).element, "click");
    await flushPromises();
  }

  async function setStake(value: string) {
    const input = q("#upgrader-stake");
    (input.element as HTMLInputElement).value = value;
    await input.trigger("input");
  }

  const wheel = () => q(".wheel");
  const rotationOf = () =>
    Number(/rotate\(([-\d.]+)deg\)/.exec(wheel().attributes("style") ?? "")![1]);

  async function finishSpin() {
    const el = wheel().element;
    el.dispatchEvent(Object.assign(new Event("transitionend"), { propertyName: "transform" }));
    await nextTick();
  }

  describe("opening and the default bet", () => {
    it("renders nothing while closed, and the dialog once ui.upgraderOpen is set", async () => {
      wrapper = mount(UpgraderModal, { attachTo: document.body });
      expect(q(".upgrader").exists()).toBe(false);
      useUiStore().upgraderOpen = true;
      await nextTick();
      expect(q(".upgrader").exists()).toBe(true);
    });

    it("defaults the stake to 10% of the PhDs owned and the multiplier to x2", async () => {
      await open(250);
      expect((q("#upgrader-stake").element as HTMLInputElement).value).toBe("25");
      expect(q(".seg-btn.active").text()).toBe("×2");
    });

    it("never defaults below the smallest valid stake or above what is owned", async () => {
      await open(3); // 10% is 0.3 -> at least 1
      expect((q("#upgrader-stake").element as HTMLInputElement).value).toBe("1");
    });
  });

  describe("the odds shown are the real odds", () => {
    it("x2 on 25 PhD: 45% to win, +25 on a win, -25 on a loss", async () => {
      await open(250);
      expect(text(".hub-pct")).toBe("45%");
      expect(text(".outcome.win .outcome-main")).toBe("+25 PhD");
      expect(text(".outcome.lose .outcome-main")).toBe("−25 PhD");
      expect(text(".outcome.win .outcome-chance")).toBe("45%");
      expect(text(".outcome.lose .outcome-chance")).toBe("55%");
    });

    it("draws the win arc as exactly that share of the ring", async () => {
      await open(250);
      expect(q(".wheel-win").attributes("stroke-dasharray")).toBe("45 55");
    });

    it("regression: a fractional-percent chance keeps its decimal (x36 -> 2.5%, never 2% or 3%)", async () => {
      const game = await open(250);
      void game;
      (wrapper!.vm as unknown as { multiplier: number }).multiplier = 36;
      await setStake("40"); // payout 1440, chance 900000 * 40 / 1440 = 25000 ppm
      expect(text(".hub-pct")).toBe("2.5%");
      expect(text(".outcome.win .outcome-chance")).toBe("2.5%");
      expect(text(".outcome.lose .outcome-chance")).toBe("97.5%");
    });

    it("the win chance is capped at 80% however small the multiplier", async () => {
      await open(250);
      (wrapper!.vm as unknown as { multiplier: number }).multiplier = 1.2;
      await setStake("9"); // uncapped this would be 81%
      expect(text(".hub-pct")).toBe("80%");
    });

    it("says how long the consolation frenzy lasts for this stake, and when there isn't one", async () => {
      await open(1000);
      await setStake("500"); // half the stack -> 30s
      expect(text(".outcome.lose .outcome-sub")).toContain("30");
      await setStake("1"); // 1/1000 of the stack: under the grant threshold
      expect(text(".outcome.lose .outcome-sub")).not.toMatch(/\d+s/);
    });
  });

  describe("choosing the bet", () => {
    it("the quick chips set 10%, 25%, 50% and all of the PhDs", async () => {
      await open(250);
      const chips = body().findAll(".stake-row .seg-btn");
      const stakeAfter = async (i: number) => {
        await chips[i]!.trigger("click");
        return (q("#upgrader-stake").element as HTMLInputElement).value;
      };
      expect(await stakeAfter(0)).toBe("25");
      expect(await stakeAfter(1)).toBe("62");
      expect(await stakeAfter(2)).toBe("125");
      expect(await stakeAfter(3)).toBe("250");
    });

    it("strips anything that is not a digit from the stake", async () => {
      await open(250);
      await setStake("1a2.5-");
      expect((q("#upgrader-stake").element as HTMLInputElement).value).toBe("125");
    });

    it("a preset selects it, and the slider follows", async () => {
      await open(250);
      const preset = body()
        .findAll(".field .seg-btn")
        .find((b) => b.text() === "×5")!;
      await preset.trigger("click");
      expect(preset.attributes("aria-pressed")).toBe("true");
      expect(text(".mult-value")).toBe("×5");
      expect((q(".slider").element as HTMLInputElement).value).toBe(
        String(Math.round(multiplierToSlider(5) * 1000))
      );
    });

    it("moving the slider changes the multiplier and deselects every preset", async () => {
      await open(250);
      const slider = q(".slider");
      (slider.element as HTMLInputElement).value = "1000";
      await slider.trigger("input");
      expect(text(".mult-value")).toBe("×100");
      expect(body().findAll(".field .seg-btn.active")).toHaveLength(0);
      // x100 on 25 PhD: payout 2500, chance 0.9%.
      expect(text(".hub-pct")).toBe("0.9%");
    });

    it("the slider's low end is x1.2", async () => {
      await open(250);
      const slider = q(".slider");
      (slider.element as HTMLInputElement).value = "0";
      await slider.trigger("input");
      expect(text(".mult-value")).toBe("×1.2");
    });
  });

  describe("why a bet can't be spun", () => {
    const status = () => text(".status");
    const spinDisabled = () => q(".spin-btn").attributes("disabled") !== undefined;

    it("a stake whose payout wouldn't exceed it says so, with the smallest stake that works", async () => {
      await open(250);
      const preset = body()
        .findAll(".field .seg-btn")
        .find((b) => b.text() === "×1.5")!;
      await preset.trigger("click");
      await setStake("1");
      expect(status()).toContain("2"); // at least 2 PhD at x1.5
      expect(status()).toContain("1.5");
      expect(spinDisabled()).toBe(true);
    });

    it("an empty stake asks for one", async () => {
      await open(250);
      await setStake("");
      expect(status()).not.toBe("");
      expect(spinDisabled()).toBe(true);
    });

    it("a stake above the PhDs owned is refused, naming the limit", async () => {
      await open(250);
      await setStake("251");
      expect(status()).toContain("250");
      expect(spinDisabled()).toBe(true);
    });

    it("with no PhDs at all there is nothing to spin", async () => {
      await open(0);
      expect(status()).not.toBe("");
      expect(spinDisabled()).toBe(true);
      expect(body().findAll(".stake-row .seg-btn").every((b) => b.attributes("disabled") !== undefined)).toBe(true);
    });

    it("a restricted account can't spin and is told why", async () => {
      await open(250);
      useAntiCheatStore().isRestricted = true;
      await nextTick();
      expect(status()).not.toBe("");
      expect(spinDisabled()).toBe(true);
    });

    it("a valid bet shows no problem and enables Spin", async () => {
      await open(250);
      expect(status()).toBe("");
      expect(spinDisabled()).toBe(false);
    });
  });

  describe("spinning (guest, local roll)", () => {
    it("lands the pointer exactly on the roll: a win roll of 100,000 ppm is 36 degrees round", async () => {
      stubRoll(100_000);
      await open(250);
      await click(".spin-btn");

      // Five full turns forward, plus whatever aligns wheel-angle 36 under the
      // fixed pointer at the top: rotating by -36 degrees == +324.
      expect(rotationOf()).toBe(5 * 360 + 324);
      expect(wheel().classes()).toContain("animating");
    });

    it("lands a losing roll of 900,000 ppm (324 degrees) outside the win arc", async () => {
      stubRoll(900_000);
      await open(250);
      await click(".spin-btn");
      expect(rotationOf()).toBe(5 * 360 + 36);
      // 324 degrees is past the 45% arc (162 degrees): a loss.
    });

    it("a win: holds the PhD readout until the wheel stops, then shows the result and lights the Win tile", async () => {
      stubRoll(100_000);
      const game = await open(250);
      await click(".spin-btn");

      // The economy already reflects the win, the readout still shows 250.
      expect(game.phdCount).toBe(275);
      expect(game.phdCountDisplay).toBe(250);
      expect(text(".field-value")).toContain("250");
      expect(q(".status-main").exists()).toBe(false);

      await finishSpin();
      expect(game.phdCountDisplay).toBe(275);
      expect(text(".status-main")).toContain("25");
      expect(q(".status-main").classes()).toContain("won");
      expect(text(".status-sub")).toContain("275");
      expect(q(".outcome.win").classes()).toContain("hit");
      expect(q(".outcome.lose").classes()).toContain("miss");
      expect(text(".spin-btn")).toBe("Spin again");
    });

    it("a loss: takes the stake, shows it, and says the frenzy is running", async () => {
      stubRoll(900_000);
      const game = await open(250);
      await click(".spin-btn");
      await finishSpin();

      expect(game.phdCount).toBe(225);
      expect(q(".status-main").classes()).toContain("lost");
      expect(text(".status-main")).toContain("25");
      expect(text(".status-sub")).toContain("6"); // 25 of 250 PhD -> 6s
      expect(q(".outcome.lose").classes()).toContain("hit");
      expect(q(".outcome.win").classes()).toContain("miss");
      expect(game.activeBoosters.some((b) => b.id === "frenzy")).toBe(true);
    });

    it("locks the controls for the whole spin", async () => {
      stubRoll(100_000);
      await open(250);
      await click(".spin-btn");

      expect(text(".spin-btn")).toBe("Spinning…");
      expect(q(".spin-btn").attributes("disabled")).toBeDefined();
      expect(q("#upgrader-stake").attributes("disabled")).toBeDefined();
      expect(q(".slider").attributes("disabled")).toBeDefined();
      expect(
        body()
          .findAll(".seg-btn")
          .every((b) => b.attributes("disabled") !== undefined)
      ).toBe(true);

      await finishSpin();
      expect(q("#upgrader-stake").attributes("disabled")).toBeUndefined();
    });

    it("a second spin keeps turning forward and lands on its own roll", async () => {
      stubRoll(100_000);
      await open(250);
      await click(".spin-btn");
      const first = rotationOf();
      await finishSpin();

      stubRoll(500_000); // 180 degrees
      await click(".spin-btn");
      const second = rotationOf();

      expect(second).toBeGreaterThan(first + 5 * 360 - 1);
      // Whatever it started from, the pointer ends on wheel-angle 180.
      expect((((-second) % 360) + 360) % 360).toBeCloseTo(180, 6);
    });

    it("choosing a different bet after a result starts afresh", async () => {
      stubRoll(100_000);
      await open(250);
      await click(".spin-btn");
      await finishSpin();
      expect(q(".status-main").exists()).toBe(true);

      await setStake("30");
      expect(q(".status-main").exists()).toBe(false);
      expect(text(".spin-btn")).toBe("Spin");
      expect(q(".outcome.hit").exists()).toBe(false);
    });

    it("regression: a result describes the bet that was placed, not whatever the balance is now", async () => {
      stubRoll(900_000);
      await open(250);
      await click(".spin-btn"); // stake 25 of 250 lost -> 225 left
      const placedFrenzy = text(".outcome.lose .outcome-sub");
      await finishSpin();

      // The frenzy on the tile is the one this bet earned (25/250 of 60s = 6s),
      // not what the same stake would earn against the new balance (25/225 = 7s).
      expect(text(".outcome.lose .outcome-sub")).toBe(placedFrenzy);
      expect(text(".outcome.lose .outcome-sub")).toContain("6s");
      expect(text(".outcome.lose .outcome-sub")).not.toContain("7s");
      expect(text(".outcome.lose .outcome-main")).toBe("−25 PhD");
    });

    it("with reduced motion the result is shown at once, with no travel to wait for", async () => {
      vi.spyOn(window, "matchMedia").mockImplementation(
        (query: string) =>
          ({
            matches: query.includes("prefers-reduced-motion"),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {}
          }) as unknown as MediaQueryList
      );
      stubRoll(100_000);
      const game = await open(250);
      await click(".spin-btn");
      await flushPromises();

      expect(text(".status-main")).toContain("25");
      expect(game.phdCountDisplay).toBe(275);
      expect(rotationOf()).toBe(5 * 360 + 324); // still lands on the roll
    });
  });

  describe("anti-cheat and lifecycle", () => {
    it("an untrusted click spins nothing", async () => {
      stubRoll(100_000);
      const game = await open(250);
      await q(".spin-btn").trigger("click"); // synthetic: isTrusted is false
      await flushPromises();
      expect(game.phdCount).toBe(250);
      expect(rotationOf()).toBe(0);
    });

    it("pressing Enter in the stake field spins too", async () => {
      stubRoll(100_000);
      const game = await open(250);
      const input = q("#upgrader-stake").element;
      const e = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      Object.defineProperty(e, "isTrusted", { value: true });
      input.dispatchEvent(e);
      await flushPromises();
      expect(game.phdCount).toBe(275);
    });

    it("closing mid-spin lets the PhD readout catch up and resets for the next time", async () => {
      stubRoll(100_000);
      const game = await open(250);
      await click(".spin-btn");
      expect(game.phdDisplayHold).toBe(250);

      useUiStore().upgraderOpen = false;
      await nextTick();
      expect(game.phdDisplayHold).toBeNull();
      expect(game.phdCountDisplay).toBe(275);

      useUiStore().upgraderOpen = true;
      await nextTick();
      expect(text(".spin-btn")).toBe("Spin");
      expect(q(".status-main").exists()).toBe(false);
    });

    it("regression: closing while the server is still answering leaves no PhD readout stuck on the old value", async () => {
      const auth = useAuthStore();
      auth.user = { id: 1, username: "u", email: "u@example.com" };
      let answer!: (v: unknown) => void;
      vi.mocked(api.upgrader.spin).mockReturnValue(
        new Promise((r) => {
          answer = r;
        }) as never
      );
      const game = await open(250);
      await click(".spin-btn");
      await vi.waitFor(() => expect(api.upgrader.spin).toHaveBeenCalled());

      useUiStore().upgraderOpen = false; // closed before the answer lands
      await nextTick();
      answer({
        message: "Spin settled.",
        won: true,
        rollPpm: 100_000,
        winPpm: 450_000,
        payout: 50,
        phdCount: 275,
        upgraderSeq: 1
      });
      await flushPromises();

      expect(game.phdCount).toBe(275);
      expect(game.phdDisplayHold).toBeNull();
      expect(game.phdCountDisplay).toBe(275);
    });
  });

  describe("logged in", () => {
    it("animates to the server's roll and shows the server's outcome", async () => {
      useAuthStore().user = { id: 1, username: "u", email: "u@example.com" };
      vi.mocked(api.upgrader.spin).mockResolvedValue({
        message: "Spin settled.",
        won: false,
        rollPpm: 750_000, // 270 degrees
        winPpm: 450_000,
        payout: 50,
        phdCount: 225,
        upgraderSeq: 1,
        consolation: { boosterId: "frenzy", remainingMs: 6000 }
      });
      const game = await open(250);
      await click(".spin-btn");

      expect(api.upgrader.spin).toHaveBeenCalledWith(25, 2);
      expect((((-rotationOf()) % 360) + 360) % 360).toBeCloseTo(270, 6);
      await finishSpin();
      expect(game.phdCount).toBe(225);
      expect(game.upgraderSeq).toBe(1);
      expect(q(".status-main").classes()).toContain("lost");
    });

    it("a refused spin leaves the wheel where it was and the bet editable", async () => {
      useAuthStore().user = { id: 1, username: "u", email: "u@example.com" };
      const { ApiError } = await import("@/lib/api");
      vi.mocked(api.upgrader.spin).mockRejectedValue(new ApiError(400, "bad", {}));
      const game = await open(250);
      await click(".spin-btn");

      expect(game.phdCount).toBe(250);
      expect(rotationOf()).toBe(0);
      expect(text(".spin-btn")).toBe("Spin");
      expect(q("#upgrader-stake").attributes("disabled")).toBeUndefined();
    });
  });

  describe("guests", () => {
    it("are told their PhDs aren't saved; logged-in players aren't", async () => {
      await open(250);
      expect(body().text()).toContain("not saved");
      wrapper!.unmount();
      wrapper = null;
      document.body.innerHTML = "";

      useAuthStore().user = { id: 1, username: "u", email: "u@example.com" };
      await open(250);
      expect(body().text()).not.toContain("not saved");
    });
  });
});
