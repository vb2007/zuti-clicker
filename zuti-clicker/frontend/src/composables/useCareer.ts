import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useSaveStore, SyncFlushError } from "@/stores/saveStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { useToastStore } from "@/stores/toastStore";
import { api, ApiError, CAREER_CODES, careerErrorCode, type CareerMutationResponse } from "@/lib/api";

/**
 * Buys, refunds and closes the Academic Career purchase window end to end.
 *
 * Logged in, every change is settled by the server (POST /career/*), wrapped
 * in saveStore.withSyncLock exactly like an Upgrader spin: a purchase changes
 * the PhD balance (and so the PhD discount), so the server must first hold
 * everything the player did so far, and no other save may go out until the
 * server's resulting state has been adopted here. game.careerPending refuses
 * purchases and prestige in between. A guest has no server state, so the same
 * rules (utils/careerCore.ts) run locally.
 *
 * Each action resolves true when it took effect; false when it didn't (the
 * player has already been told why, if there was anything to tell).
 */
export function useCareer() {
  const game = useGameStore();
  const auth = useAuthStore();
  const save = useSaveStore();
  const antiCheat = useAntiCheatStore();
  const toast = useToastStore();
  const { t } = useI18n();

  function reportFailure(e: unknown): void {
    if (e instanceof SyncFlushError) {
      if (!e.stale) toast.push("error", t("career.errors.syncFailed"));
      return;
    }
    if (e instanceof ApiError) {
      // lib/api.ts's interceptor already applied a 403 and the warning modal shows.
      if (e.status === 403) return;
      const code = careerErrorCode(e);
      if (code !== undefined) {
        // The server's real state rides along on every career 409 — adopt it,
        // so whatever made this one fail (another tab, a closed window) is
        // reflected at once instead of failing again.
        const body = e.body as Partial<CareerMutationResponse> | undefined;
        if (body?.career) game.applyCareerState(body as CareerMutationResponse);
        const key =
          code === CAREER_CODES.windowClosed
            ? "career.errors.windowClosed"
            : code === CAREER_CODES.insufficientPhd
              ? "career.errors.insufficient"
              : "career.errors.changed";
        toast.push("error", t(key));
        return;
      }
      if (e.status === 400) {
        toast.push("error", t("career.errors.generic"));
        return;
      }
    }
    // Anything else (a timeout, a dropped connection, a 5xx) is AMBIGUOUS: the
    // server may or may not have applied it. Take the server's word instead.
    if (auth.isLoggedIn) {
      toast.push("error", t("career.errors.unconfirmed"));
      void save.load();
    } else {
      toast.push("error", t("career.errors.generic"));
    }
  }

  async function settle(
    local: () => boolean,
    remote: () => Promise<CareerMutationResponse>
  ): Promise<boolean> {
    if (antiCheat.isRestricted || game.serverActionPending) return false;
    if (!auth.isLoggedIn) return local();

    game.careerPending = true;
    const epoch = game.resetEpoch;
    try {
      return await save.withSyncLock(async () => {
        const res = await remote();
        // The save was deleted or reset meanwhile: this result belongs to a
        // game that no longer exists — reload rather than write it onto the new one.
        if (game.resetEpoch !== epoch) throw new Error("save reset during a career change");
        game.applyCareerState(res);
        return true;
      });
    } catch (err) {
      reportFailure(err);
      return false;
    } finally {
      game.careerPending = false;
    }
  }

  /**
   * `e` is the click that triggered it: a synthetic one is counted as an
   * automation signal and buys nothing, the same as the shop's buy buttons.
   */
  function buy(nodeId: string, e: Event): Promise<boolean> {
    if (!e.isTrusted) {
      antiCheat.recordClick(false);
      return Promise.resolve(false);
    }
    return settle(
      () => game.buyCareerNodeLocal(nodeId),
      () => api.career.buy(nodeId)
    );
  }

  function refund(nodeId: string, e: Event): Promise<boolean> {
    if (!e.isTrusted) {
      antiCheat.recordClick(false);
      return Promise.resolve(false);
    }
    return settle(
      () => game.refundCareerNodeLocal(nodeId),
      () => api.career.refund(nodeId)
    );
  }

  /**
   * Skip / Done. Changes no PhDs, so no flush is needed; allowed while
   * restricted (it grants nothing). A refusal because a newer window opened
   * meanwhile adopts that window, which then stays up.
   */
  async function close(): Promise<boolean> {
    if (!auth.isLoggedIn) {
      game.closeCareerWindowLocal();
      return true;
    }
    if (game.careerPending) return false;
    game.careerPending = true;
    try {
      game.applyCareerState(await api.career.close(game.careerWindowId));
      return true;
    } catch (err) {
      if (err instanceof ApiError && careerErrorCode(err) === CAREER_CODES.windowChanged) {
        game.applyCareerState(err.body as CareerMutationResponse);
        toast.push("error", t("career.errors.newWindow"));
        return false;
      }
      toast.push("error", t("career.errors.closeFailed"));
      return false;
    } finally {
      game.careerPending = false;
    }
  }

  return { buy, refund, close };
}
