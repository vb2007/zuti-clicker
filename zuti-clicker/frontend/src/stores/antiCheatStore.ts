import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "@/lib/api";
import { useAuthStore } from "./authStore";
import { buildDigest, countWithinWindow } from "@/utils/clickTelemetry";
import { checkNativeIntegrity, createHoneypotTracker } from "@/utils/integrityChecks";
import { createPointerPhysicsTracker } from "@/utils/pointerPhysics";
import {
  BURST_CPS_CAP,
  BURST_WINDOW_MS,
  GUEST_RESTRICTION_MINUTES_BY_STRIKE,
  GUEST_SAVE_RESET_STRIKE
} from "@/utils/antiCheatConstants";

const GUEST_STRIKES_KEY = "zuti-clicker:guestAntiCheatStrikes";

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
    windowStartedAt = performance.now();
  }

  // Returns true once the guest has reached the "reset" strike — there is no
  // server save to delete for a guest, so the composable that owns
  // gameStore calls hardReset() itself when this comes back true.
  function applyGuestStrike(): boolean {
    const strikes = readGuestStrikeCount() + 1;
    writeGuestStrikeCount(strikes);
    strikeCount.value = strikes;
    restrictedUntil.value = new Date(Date.now() + guestRestrictionMinutes(strikes) * 60_000);
    isRestricted.value = true;
    return strikes >= GUEST_SAVE_RESET_STRIKE;
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
   */
  function recordClick(trusted: boolean): ClickOutcome {
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
      return guestSaveReset;
    }

    const windowMs = Math.max(1, performance.now() - windowStartedAt);
    const digest = buildDigest({
      windowMs,
      clickTimestamps,
      purchases,
      untrustedClicks,
      hiddenClicks,
      droppedClicks,
      integrityFlags,
      weakSignals: pointerPhysics.getFlags()
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
   * correct countdown immediately. No-op for guests (state is already
   * authoritative in localStorage/memory for them). */
  async function fetchStatus(): Promise<void> {
    if (!auth.isLoggedIn) return;
    try {
      const result = await api.anticheat.status();
      applyServerResult(result);
    } catch {
      // Keep whatever was last known rather than guessing.
    }
  }

  /** Called once, on app mount — wires the honeypot and, for a guest with a
   * still-active restriction from a previous session, restores it. */
  function initialize(): void {
    installClientChecks();
    if (!auth.isLoggedIn) {
      const strikes = readGuestStrikeCount();
      if (strikes > 0) strikeCount.value = strikes;
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
    fetchStatus
  };
});
