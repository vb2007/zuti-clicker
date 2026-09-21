import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "@/lib/api";
import { useAuthStore } from "./authStore";
import { buildDigest, countWithinWindow, type ClickMethod, type MethodCounts } from "@/utils/clickTelemetry";
import { checkNativeIntegrity, createHoneypotTracker } from "@/utils/integrityChecks";
import { createPointerPhysicsTracker } from "@/utils/pointerPhysics";
import {
  BURST_CPS_CAP,
  BURST_WINDOW_MS,
  GUEST_RESTRICTION_MINUTES_BY_STRIKE,
  GUEST_SAVE_RESET_STRIKE,
  MAX_DIGEST_WINDOW_MS
} from "@/utils/antiCheatConstants";

const GUEST_STRIKES_KEY = "zuti-clicker:guestAntiCheatStrikes";
// Stores ONLY the restriction's end time (epoch ms), never a separate
// "isRestricted" boolean — deriving isRestricted from a comparison against
// the current clock, the same way the server does for a logged-in account,
// means there is no second flag that can drift out of sync with it, and a
// page reload can never "helpfully" clear an active restriction just
// because that separate flag was never persisted in the first place.
const GUEST_RESTRICTED_UNTIL_KEY = "zuti-clicker:guestRestrictedUntil";

export interface ClickOutcome {
  credited: boolean;
  guestSaveReset: boolean;
}

function readGuestStrikeCount(): number {
  try {
    const raw = localStorage.getItem(GUEST_STRIKES_KEY);
    const n = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeGuestStrikeCount(n: number): void {
  try {
    localStorage.setItem(GUEST_STRIKES_KEY, String(n));
  } catch {
    // localStorage unavailable (private browsing, quota) — the strike still
    // applies for this session via in-memory state, it just won't persist.
  }
}

/** The persisted restriction end time, or null if absent/corrupt/already
 * past — a past value is treated exactly like "none" by every caller, so
 * this is the one place that distinction is made. */
function readGuestRestrictedUntil(): Date | null {
  try {
    const raw = localStorage.getItem(GUEST_RESTRICTED_UNTIL_KEY);
    if (raw === null) return null;
    const ms = Number.parseInt(raw, 10);
    if (!Number.isFinite(ms) || ms <= Date.now()) return null;
    return new Date(ms);
  } catch {
    return null;
  }
}

function writeGuestRestrictedUntil(until: Date | null): void {
  try {
    if (until === null) {
      localStorage.removeItem(GUEST_RESTRICTED_UNTIL_KEY);
    } else {
      localStorage.setItem(GUEST_RESTRICTED_UNTIL_KEY, String(until.getTime()));
    }
  } catch {
    // Same as writeGuestStrikeCount — applies for this session regardless.
  }
}

function guestRestrictionMinutes(strike: number): number {
  if (strike <= 0) return 0;
  const idx = Math.min(strike, GUEST_RESTRICTION_MINUTES_BY_STRIKE.length) - 1;
  return GUEST_RESTRICTION_MINUTES_BY_STRIKE[idx]!;
}

/**
 * The anti-cheat client: click-timing telemetry, script-integrity/honeypot
 * checks, and pointer-physics tracking, reported to the server on a fixed
 * heartbeat (see composables/useAntiCheat.ts) independent of the autosave
 * setting. Also the single source of truth for whether play is currently
 * restricted — gameStore/ClickerCircle/UnitCard/UpgradeTile/usePrestige all
 * read `isRestricted` from here rather than each tracking it separately.
 *
 * Guests (never authenticated, so POST /anticheat/report has nothing to
 * report to) get a deliberately narrower, LOCAL-ONLY path: only the
 * zero-false-positive signals (untrusted/synthetic clicks, a
 * honeypot/integrity trip) can restrict a guest, tracked in localStorage —
 * see the plan's "guest mode" decision. A logged-in account's restriction
 * always comes from the server; nothing here ever sets it locally for one.
 */
export const useAntiCheatStore = defineStore("antiCheat", () => {
  const auth = useAuthStore();

  const isRestricted = ref(false);
  const restrictedUntil = ref<Date | null>(null);
  const strikeCount = ref(0);

  // Telemetry accumulators for the current window — plain closured state,
  // not `ref()`, since nothing needs to react to them changing moment to
  // moment; only the heartbeat (and the burst-cap check) ever reads them.
  let clickTimestamps: number[] = [];
  let purchases = 0;
  let untrustedClicks = 0;
  let hiddenClicks = 0;
  let droppedClicks = 0;
  let methodCounts: MethodCounts = { primary: 0, secondary: 0, enter: 0, space: 0, touch: 0, other: 0 };
  let windowStartedAt = performance.now();

  const honeypot = createHoneypotTracker();
  const pointerPhysics = createPointerPhysicsTracker();

  function installClientChecks(): void {
    honeypot.install();
  }

  function onPointerMove(e: PointerEvent): void {
    pointerPhysics.onPointerMove(e);
  }

  function onPointerDown(e: PointerEvent): void {
    pointerPhysics.onPointerDown(e);
  }

  function resetWindow(): void {
    clickTimestamps = [];
    purchases = 0;
    untrustedClicks = 0;
    hiddenClicks = 0;
    droppedClicks = 0;
    methodCounts = { primary: 0, secondary: 0, enter: 0, space: 0, touch: 0, other: 0 };
    windowStartedAt = performance.now();
  }

  // Returns true once the guest has reached the "reset" strike — there is no
  // server save to delete for a guest, so the composable that owns
  // gameStore calls hardReset() itself when this comes back true.
  function applyGuestStrike(): boolean {
    const strikes = readGuestStrikeCount() + 1;
    writeGuestStrikeCount(strikes);
    strikeCount.value = strikes;
    const until = new Date(Date.now() + guestRestrictionMinutes(strikes) * 60_000);
    restrictedUntil.value = until;
    writeGuestRestrictedUntil(until);
    isRestricted.value = true;
    return strikes >= GUEST_SAVE_RESET_STRIKE;
  }

  /** Re-derives isRestricted from the wall clock for a guest — the only way
   * a guest's restriction ever clears, since there is no server to poll.
   * Called from fetchStatus() (itself called on mount and by
   * CheatWarningModal's own countdown reaching zero), so a guest gets the
   * same "checked proactively as soon as the timer visually ends" behavior
   * a logged-in account gets from the server. */
  function checkGuestRestrictionExpiry(): void {
    if (restrictedUntil.value !== null && Date.now() >= restrictedUntil.value.getTime()) {
      isRestricted.value = false;
      restrictedUntil.value = null;
      writeGuestRestrictedUntil(null);
    }
  }

  /**
   * True if this click must be dropped (silent burst cap) rather than
   * counted at all — call BEFORE the game store credits any tokens for it.
   */
  function shouldDropForBurst(): boolean {
    return countWithinWindow(clickTimestamps, performance.now(), BURST_WINDOW_MS) >= BURST_CPS_CAP;
  }

  /**
   * Registers one real click attempt. `trusted` must be `MouseEvent/
   * PointerEvent.isTrusted` from the ORIGINAL event — never re-derived.
   * `credited: false` means the caller must skip crediting any tokens for
   * this click (untrusted or burst-dropped); `guestSaveReset: true` means
   * the caller must also call gameStore.hardReset() right now — a guest has
   * no server save for the equivalent server-side reset to apply to.
   *
   * `method` is omitted by UnitCard/UpgradeTile/usePrestige's own
   * `recordClick(false)` calls (detecting a synthetic click on a purchase/
   * prestige button) — irrelevant there since untrusted clicks return before
   * ever touching methodCounts. Only ClickerCircle's actual token-earning
   * click supplies it.
   */
  function recordClick(trusted: boolean, method?: ClickMethod): ClickOutcome {
    if (!trusted) {
      untrustedClicks++;
      const guestSaveReset = !auth.isLoggedIn && applyGuestStrike();
      return { credited: false, guestSaveReset };
    }
    if (shouldDropForBurst()) {
      droppedClicks++;
      return { credited: false, guestSaveReset: false };
    }
    clickTimestamps.push(performance.now());
    if (method !== undefined) methodCounts[method]++;
    return { credited: true, guestSaveReset: false };
  }

  /** A click that landed while the document was hidden/unfocused. */
  function recordHiddenClick(): void {
    hiddenClicks++;
  }

  function recordPurchase(): void {
    purchases++;
  }

  function applyServerResult(result: {
    restrictedUntil: string | null;
    strikeCount: number;
    isRestricted?: boolean;
    status?: "clean" | "restricted";
  }): void {
    isRestricted.value = result.isRestricted ?? result.status === "restricted";
    restrictedUntil.value = result.restrictedUntil ? new Date(result.restrictedUntil) : null;
    strikeCount.value = result.strikeCount;
  }

  /**
   * Sent on the fixed heartbeat and immediately after any zero-false-positive
   * local detection — see composables/useAntiCheat.ts. Returns whether a
   * guest just hit the reset strike (see recordClick's own comment on why
   * that's the caller's responsibility, not this store's).
   */
  async function sendHeartbeat(): Promise<boolean> {
    const integrityFlags = [...new Set([...honeypot.drainFlags(), ...checkNativeIntegrity()])];

    if (!auth.isLoggedIn) {
      // No server digest to send, but a guest's honeypot/integrity trip is
      // still a zero-false-positive local detection and must still strike.
      const guestSaveReset = integrityFlags.length > 0 && applyGuestStrike();
      resetWindow();
      // A logged-in account gets a fresh isRestricted every heartbeat (the
      // server recomputes it from its own clock on every report) even if
      // CheatWarningModal was dismissed — mirror that for guests instead of
      // relying solely on the modal's own countdown-driven fetchStatus call.
      if (!guestSaveReset) checkGuestRestrictionExpiry();
      return guestSaveReset;
    }

    // Rounded to a whole millisecond — performance.now() is sub-millisecond
    // precision, and the server accepts any non-negative finite duration
    // here regardless, but there's no reason to ship the extra digits.
    const windowMs = Math.max(1, Math.round(performance.now() - windowStartedAt));

    // A window this large means the browser's own timer was suspended
    // through some of it — a backgrounded tab, a locked screen, a laptop
    // lid close (iOS/WebKit suspends setInterval outright while
    // backgrounded; this is the exact root cause of a real production
    // incident: "banned for opening the prestige modal for a few
    // seconds"). windowMs then carries no real timing information — clicks
    // is typically 0 anyway — so there is nothing worth reporting. Re-
    // baseline and skip this cycle entirely rather than sending it; the
    // server would only treat it as unscoreable regardless (see
    // api/src/services/antiCheat.ts), but there's no reason to make that
    // round trip.
    if (windowMs > MAX_DIGEST_WINDOW_MS) {
      resetWindow();
      return false;
    }

    const digest = buildDigest({
      windowMs,
      clickTimestamps,
      purchases,
      untrustedClicks,
      hiddenClicks,
      droppedClicks,
      integrityFlags,
      weakSignals: pointerPhysics.getFlags(),
      methodCounts
    });
    resetWindow();

    try {
      const result = await api.anticheat.report(digest);
      applyServerResult(result);
    } catch {
      // A failed report must never block play — the next heartbeat tries
      // again, and the envelope/PUT-save path still catches anything that
      // matters regardless of whether telemetry made it through.
    }
    return false;
  }

  /** Refreshes restriction status without waiting for the next heartbeat —
   * called on mount/login so a page reload mid-restriction shows the
   * correct countdown immediately, and by CheatWarningModal's own countdown
   * reaching zero. For a guest this re-derives isRestricted from the wall
   * clock (see checkGuestRestrictionExpiry) instead of calling the server. */
  async function fetchStatus(): Promise<void> {
    if (!auth.isLoggedIn) {
      checkGuestRestrictionExpiry();
      return;
    }
    try {
      const result = await api.anticheat.status();
      applyServerResult(result);
    } catch {
      // Keep whatever was last known rather than guessing.
    }
  }

  /** Called once, on app mount — wires the honeypot and, for a guest,
   * restores strikeCount and any still-active restriction from a previous
   * session (an already-expired one is treated as none — see
   * readGuestRestrictedUntil). */
  function initialize(): void {
    installClientChecks();
    if (!auth.isLoggedIn) {
      const strikes = readGuestStrikeCount();
      if (strikes > 0) strikeCount.value = strikes;
      const until = readGuestRestrictedUntil();
      if (until !== null) {
        restrictedUntil.value = until;
        isRestricted.value = true;
      }
    }
  }

  return {
    isRestricted,
    restrictedUntil,
    strikeCount,
    initialize,
    onPointerMove,
    onPointerDown,
    recordClick,
    recordHiddenClick,
    recordPurchase,
    sendHeartbeat,
    fetchStatus,
    // Exposed for useAntiCheat.ts's visibilitychange listener — re-baselines
    // the moment the page becomes foreground again, rather than waiting for
    // the next heartbeat tick to notice the window ran long through a
    // background period (sendHeartbeat's own oversized-window check above
    // is the backstop if this never fires). Discarding a partial window's
    // telemetry here costs nothing real — it's diagnostic data, not
    // gameplay — and only ever favors the player.
    resetWindow,
    // Exposed for lib/api.ts's shared request() interceptor — a restricted
    // account gets a 403 from ANY write endpoint (PUT /save, boosters/claim,
    // not just the report/status ones this store otherwise calls), and that
    // 403 must update isRestricted/restrictedUntil (and pop the modal)
    // immediately, not wait up to a minute for the next heartbeat.
    applyServerResult
  };
});
