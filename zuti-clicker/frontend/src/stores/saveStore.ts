import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { api, isStaleSaveError, type ApiError } from "@/lib/api";
import { i18n } from "@/i18n";
import { useAuthStore } from "./authStore";
import { useGameStore } from "./gameStore";
import { useSettingsStore } from "./settingsStore";
import { useToastStore } from "./toastStore";

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

  const lastSyncedAt = ref<Date | null>(null);
  const isSyncing = ref(false);
  const syncError = ref<string | null>(null);

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
  let _locked = false;
  let _inflight: Promise<SyncOutcome> | null = null;

  // One PUT /save. Resolves with how it went and never rejects. A STALE
  // refusal — this save was made before a wheel spin that happened elsewhere
  // (another tab) — is not an error to show in the sync indicator: the
  // server's progress is simply newer, so reload it and say so.
  async function _performSync(): Promise<SyncOutcome> {
    isSyncing.value = true;
    syncError.value = null;
    try {
      const result = await api.save.store(game.toSavePayload());
      lastSyncedAt.value = new Date(result.savedAt);
      return "ok";
    } catch (e) {
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
    if (!auth.isLoggedIn) return;
    if (isSyncing.value || _locked) {
      _queued = true;
      return;
    }
    _inflight = _performSync();
    try {
      await _inflight;
    } finally {
      _inflight = null;
      if (_queued && !_locked) {
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
   */
  async function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
    if (_locked) throw new Error("The save sync lock is already held");
    _locked = true;
    try {
      if (auth.isLoggedIn) {
        // A sync already in flight may itself come back stale (and reload): its
        // outcome counts, or the spin would go ahead on state it just discarded.
        if (_inflight && (await _inflight) === "stale") throw new SyncFlushError(true);
        const flushed = await _performSync();
        if (flushed !== "ok") throw new SyncFlushError(flushed === "stale");
      }
      return await fn();
    } finally {
      _locked = false;
      if (_queued) {
        _queued = false;
        void sync();
      }
    }
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

  return {
    lastSyncedAt,
    isSyncing,
    syncError,
    load,
    sync,
    withSyncLock,
    resetSave
  };
});
