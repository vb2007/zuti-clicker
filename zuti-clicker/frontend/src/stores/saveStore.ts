import { defineStore } from "pinia";
import { ref, watch } from "vue";
import {
  api,
  isFirstSaveUnverifiableError,
  isStaleSaveError,
  type ApiError
} from "@/lib/api";
import { i18n } from "@/i18n";
import { useAuthStore } from "./authStore";
import { useGameStore } from "./gameStore";
import { useSettingsStore } from "./settingsStore";
import { useToastStore } from "./toastStore";
import { useUiStore } from "./uiStore";

/**
 * The save flush that withSyncLock needs before its work could not be completed.
 * `stale` is true when the cause was a stale save (progress changed in another
 * tab): the store has already reloaded and told the player, so a caller should
 * not pile a second message on top.
 */
export class SyncFlushError extends Error {
  constructor(public readonly stale: boolean) {
    super("The pre-action save flush failed");
    this.name = "SyncFlushError";
  }
}

type SyncOutcome = "ok" | "stale" | "error";

export const useSaveStore = defineStore("save", () => {
  const auth = useAuthStore();
  const game = useGameStore();
  const settings = useSettingsStore();
  const toast = useToastStore();
  const ui = useUiStore();

  const lastSyncedAt = ref<Date | null>(null);
  const isSyncing = ref(false);
  const syncError = ref<string | null>(null);
  // The account's first save — progress made as a guest — was refused as
  // unverifiable (see isFirstSaveUnverifiableError). Every sync is held until
  // the player picks one of FirstSaveRejectedModal's two ways out: resending
  // the same progress would only be refused again.
  const carryOverRejected = ref(false);

  let _timer: ReturnType<typeof setInterval> | null = null;

  function _clearTimer(): void {
    if (_timer !== null) {
      clearInterval(_timer);
      _timer = null;
    }
  }

  function _startTimer(): void {
    _clearTimer();
    if (settings.autosaveEnabled && auth.isLoggedIn) {
      _timer = setInterval(() => {
        void sync();
      }, settings.autosaveIntervalSecs * 1000);
    }
  }

  // Getter functions, not the bare refs: settingsStore's autosave prefs are
  // read off a setup-store instance here, so a bare ref wouldn't be reactive
  // to changes made through the store's own actions.
  watch(
    [() => settings.autosaveEnabled, () => settings.autosaveIntervalSecs, () => auth.isLoggedIn],
    _startTimer,
    { immediate: true }
  );

  // Wheel results made as a guest don't carry over to the account: the server has
  // no record of them, so a first save carrying wheel-won PhDs would read as
  // forged (and a guest's local spin counter would never match a new account's 0).
  // Dropped the moment the player logs in, before any save could be made.
  watch(
    () => auth.isLoggedIn,
    (loggedIn) => {
      if (loggedIn && game.forfeitGuestSpins() !== 0) {
        toast.push("error", i18n.global.t("upgrader.guestSpinsDropped"));
      }
      // The same for a guest's Academic Career: the server has no record of it,
      // so its nodes are refunded (and what its PhD-gain bonus added is taken
      // back) before any save could carry it.
      if (loggedIn && game.forfeitGuestCareer()) {
        toast.push("error", i18n.global.t("career.guestTreeDropped"));
      }
      carryOverRejected.value = false;
    }
  );

  /** Resolves true when the server's save was applied (or there isn't one yet). */
  async function load(): Promise<boolean> {
    if (!auth.isLoggedIn) return true;
    try {
      const data = await api.save.load();
      if (data.save) {
        game.loadFromSave(data.save);
        lastSyncedAt.value = new Date(data.save.savedAt);
      }
      return true;
    } catch {
      // No save yet — start fresh — or the request failed; either way nothing was applied.
      return false;
    }
  }

  // If a sync is requested while one is already in flight (e.g. a prestige
  // immediately followed by a manual/auto sync), it is not dropped — it runs
  // once more immediately after the in-flight one finishes, capturing
  // whatever the store looks like by then. The same goes for a sync requested
  // while withSyncLock below holds the lock: it waits for the release.
  let _queued = false;
  // Holders of the sync lock, running or waiting their turn (see withSyncLock).
  let _lockDepth = 0;
  let _lockTail: Promise<void> = Promise.resolve();
  let _inflight: Promise<SyncOutcome> | null = null;

  // One PUT /save. Resolves with how it went and never rejects. A STALE
  // refusal — this save was made before a wheel spin that happened elsewhere
  // (another tab) — is not an error to show in the sync indicator: the
  // server's progress is simply newer, so reload it and say so.
  async function _performSync(): Promise<SyncOutcome> {
    isSyncing.value = true;
    syncError.value = null;
    try {
      const payload = game.toSavePayload();
      const result = await api.save.store(payload);
      lastSyncedAt.value = new Date(result.savedAt);
      // A save that carried a prestige opened an Academic Career purchase
      // window on the server — adopt it so the tree can pop up right away. But
      // only if no prestige happened while this save was on its way: a reply
      // to a save made BEFORE a prestige would otherwise shut the window that
      // prestige just opened locally (the save carrying it is queued behind).
      if (result.career && payload.prestigeCount === game.prestigeCount) {
        game.applyCareerWindow(result.career.windowOpen, result.career.windowId);
      }
      return "ok";
    } catch (e) {
      if (isFirstSaveUnverifiableError(e)) {
        carryOverRejected.value = true;
        syncError.value = (e as ApiError).message;
        return "error";
      }
      if (isStaleSaveError(e)) {
        // Only claim a reload if one happened: a failed reload leaves the stale
        // state in place, and the next sync would loop on the same refusal.
        if (await load()) toast.push("error", i18n.global.t("save.staleReloaded"));
        else syncError.value = (e as ApiError).message;
        return "stale";
      }
      syncError.value = (e as ApiError).message;
      return "error";
    } finally {
      isSyncing.value = false;
    }
  }

  async function sync(): Promise<void> {
    if (!auth.isLoggedIn || carryOverRejected.value) return;
    if (isSyncing.value || _lockDepth > 0) {
      _queued = true;
      return;
    }
    _inflight = _performSync();
    try {
      await _inflight;
    } finally {
      _inflight = null;
      if (_queued && _lockDepth === 0) {
        _queued = false;
        void sync();
      }
    }
  }

  /**
   * Runs `fn` with every other sync (autosave, manual Sync, post-prestige)
   * held back, after first flushing the current state to the server — which
   * must succeed, or `fn` never runs and a SyncFlushError is thrown. Used by
   * the upgrader: its spin changes phdCount on the server directly, so the
   * server must already hold everything the player did up to that moment (a
   * pre-spin purchase it hasn't seen would otherwise be checked against the
   * post-spin PhD count), and no save may go out between the spin settling and
   * its result being applied here (that save would carry the old balance).
   * Held syncs run once, with the then-current state, on release. Guests have
   * nothing to flush or protect, so `fn` just runs.
   *
   * Holders queue rather than collide: a second caller (a career purchase
   * while a windfall claim holds the lock, say) waits its turn, then flushes
   * the then-current state itself. Every server-side PhD/token change is thus
   * strictly one after another, and no ordinary save slips in between two of
   * them. `flush: false` skips the pre-work save (see reload()).
   */
  async function withSyncLock<T>(
    fn: () => Promise<T>,
    { flush = true }: { flush?: boolean } = {}
  ): Promise<T> {
    _lockDepth++;
    const previous = _lockTail;
    let release!: () => void;
    _lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (flush && auth.isLoggedIn) {
        // A sync already in flight may itself come back stale (and reload): its
        // outcome counts, or the spin would go ahead on state it just discarded.
        if (_inflight && (await _inflight) === "stale") throw new SyncFlushError(true);
        const flushed = await _performSync();
        if (flushed !== "ok") throw new SyncFlushError(flushed === "stale");
      }
      return await fn();
    } finally {
      _lockDepth--;
      release();
      if (_queued && _lockDepth === 0) {
        _queued = false;
        void sync();
      }
    }
  }

  /**
   * Takes the server's word after an action whose outcome is unknown (a
   * timeout, a 5xx): reloads under the sync lock, so it can never interleave
   * with another action's flush and overwrite newer state with older.
   */
  function reload(): Promise<boolean> {
    return withSyncLock(() => load(), { flush: false });
  }

  async function resetSave(): Promise<void> {
    if (!auth.isLoggedIn) return;
    // Delete server-side first; if this throws, local game state is left
    // intact rather than wiped while the server row still exists. Recording
    // the failure in syncError (rather than swallowing it) means the existing
    // sync-status indicator in the header shows the player it didn't work,
    // instead of the confirm modal silently closing as if it had.
    try {
      await api.save.reset();
    } catch (e) {
      syncError.value = (e as ApiError).message;
      throw e;
    }
    game.hardReset();
    lastSyncedAt.value = null;
    syncError.value = null;
  }

  /**
   * Logs out, then resets the game to a fresh guest: a guest's progress must
   * only ever be progress made without an account — the server credits it to
   * an account's first save as a single, unwitnessed run, and guests can't
   * prestige. The current state is flushed first; if that fails (offline, a
   * restriction) nothing happens and this resolves false, so the caller can
   * ask before `force`-ing it and losing what wasn't saved. A stale flush has
   * already reloaded the server's newer state, so there's nothing to lose.
   *
   * `keepProgress` logs out WITHOUT the flush or the reset: the "keep playing
   * as a guest" way out of a refused first save, whose progress never
   * reached the server and stays a guest's.
   */
  async function logout({
    force = false,
    keepProgress = false
  }: { force?: boolean; keepProgress?: boolean } = {}): Promise<boolean> {
    if (!auth.isLoggedIn) return true;
    if (!force && !keepProgress) {
      try {
        await withSyncLock(async () => {});
      } catch (e) {
        if (!(e instanceof SyncFlushError && e.stale)) return false;
      }
    }
    await auth.logout();
    if (!keepProgress) {
      game.hardReset();
      ui.careerOpen = false;
      ui.upgraderOpen = false;
      ui.prestigeConfirmOpen = false;
      ui.prestigeCeremonyOpen = false;
    }
    carryOverRejected.value = false;
    lastSyncedAt.value = null;
    syncError.value = null;
    return true;
  }

  /**
   * FirstSaveRejectedModal's other way out: drop the guest progress the server
   * couldn't verify and start the account from a fresh game, saved right away.
   */
  async function startAccountFresh(): Promise<void> {
    game.hardReset();
    carryOverRejected.value = false;
    syncError.value = null;
    await sync();
  }

  return {
    lastSyncedAt,
    isSyncing,
    syncError,
    carryOverRejected,
    logout,
    startAccountFresh,
    load,
    sync,
    withSyncLock,
    reload,
    resetSave
  };
});
