import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useSaveStore, SyncFlushError } from "@/stores/saveStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { useToastStore } from "@/stores/toastStore";
import { api, ApiError } from "@/lib/api";
import {
  toHundredths,
  quoteSpin,
  settleSpin,
  rollPpmLocal,
  type SpinOutcome
} from "@/utils/upgrader";
import { UPGRADER_CONSOLATION_BOOSTER_ID } from "@/utils/gameConstants";

/**
 * Runs one spin of the upgrader (the PhD wheel) end to end and hands the
 * outcome back to the modal, which owns the animation.
 *
 * Logged in, the spin is settled by the server (POST /upgrader/spin) — it alone
 * rolls and writes the new balance — wrapped in saveStore.withSyncLock, which
 * first flushes everything the player did so far (the server validates that
 * state against the pre-spin PhD count) and holds every other save back until
 * the result has been applied here. A guest has no server state, so the same
 * settlement (utils/upgrader.ts's settleSpin) runs locally.
 *
 * The PhD result is applied to the game store the moment it is known, so the
 * client's economy (production, prices) matches the server's from that instant
 * and not after the animation; the PhD readouts are held at their old value
 * until the modal calls releaseReveal(), so the number behind the wheel doesn't
 * give the result away before it stops.
 */
export function useUpgrader() {
  const game = useGameStore();
  const auth = useAuthStore();
  const save = useSaveStore();
  const antiCheat = useAntiCheatStore();
  const toast = useToastStore();
  const { t } = useI18n();

  function apply(outcome: SpinOutcome, upgraderSeq: number, phdBefore: number): void {
    game.holdPhdDisplay(phdBefore);
    game.applySpinResult(outcome.phdCount, upgraderSeq);
    if (outcome.consolation) {
      game.grantBooster(outcome.consolation.boosterId, outcome.consolation.remainingMs);
    }
  }

  function frenzyRemainingMs(): number {
    const running = game.activeBoosters.find((b) => b.id === UPGRADER_CONSOLATION_BOOSTER_ID);
    return running ? Math.max(0, running.expiresAt - Date.now()) : 0;
  }

  function reportFailure(e: unknown): void {
    if (e instanceof SyncFlushError) {
      // A stale save already told the player (and reloaded); only a genuine
      // flush failure needs saying here.
      if (!e.stale) toast.push("error", t("upgrader.errors.syncFailed"));
      return;
    }
    if (e instanceof ApiError) {
      // lib/api.ts's shared interceptor has already applied a 403 to the
      // anti-cheat store and the warning modal is showing — a toast on top
      // would only confuse what is already explained.
      if (e.status === 403) return;
      if (e.status === 409) {
        const body = e.body as { phdCount?: number } | undefined;
        if (typeof body?.phdCount === "number") {
          // The server's balance is lower than the player thought: another tab
          // spent PhDs, say. Reload so the next stake is chosen against the truth.
          toast.push("error", t("upgrader.errors.insufficient"));
          void save.load();
        } else {
          toast.push("error", t("upgrader.errors.limit"));
        }
        return;
      }
      if (e.status === 400) {
        toast.push("error", t("upgrader.errors.invalid"));
        return;
      }
    }
    toast.push("error", t("upgrader.errors.generic"));
  }

  /**
   * Resolves with the outcome, or null when the spin did not happen (restricted,
   * an untrusted event, an invalid bet, or a failure the player has been told
   * about). `e` is the click that triggered it: a synthetic one is counted as an
   * automation signal and earns nothing, the same as the shop's buy buttons.
   */
  async function spin(stake: number, multiplier: number, e: Event): Promise<SpinOutcome | null> {
    if (!e.isTrusted) {
      antiCheat.recordClick(false);
      return null;
    }
    if (antiCheat.isRestricted || game.spinPending) return null;

    // The modal only offers valid bets; this is the same check, defensively.
    const hundredths = toHundredths(multiplier);
    if (hundredths === null || quoteSpin(stake, hundredths) === null) return null;
    if (stake > game.phdCount) return null;

    // Set before the flush, cleared only once the result is applied (or the spin
    // failed): purchases and prestige are refused in between — see gameStore.
    game.spinPending = true;
    const phdBefore = game.phdCount;
    try {
      if (auth.isLoggedIn) {
        return await save.withSyncLock(async () => {
          const res = await api.upgrader.spin(stake, multiplier);
          const outcome: SpinOutcome = {
            won: res.won,
            rollPpm: res.rollPpm,
            winPpm: res.winPpm,
            payout: res.payout,
            phdCount: res.phdCount,
            ...(res.consolation ? { consolation: res.consolation } : {})
          };
          apply(outcome, res.upgraderSeq, phdBefore);
          return outcome;
        });
      }

      const outcome = settleSpin(stake, hundredths, phdBefore, rollPpmLocal(), frenzyRemainingMs());
      if (outcome === null) return null;
      apply(outcome, game.upgraderSeq + 1, phdBefore);
      return outcome;
    } catch (err) {
      reportFailure(err);
      return null;
    } finally {
      game.spinPending = false;
    }
  }

  /** The wheel has stopped (or the modal closed): let the PhD readouts catch up. */
  function releaseReveal(): void {
    game.releasePhdDisplay();
  }

  return { spin, releaseReveal };
}
