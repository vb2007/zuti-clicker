import { onMounted, onUnmounted, watch } from "vue";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { HEARTBEAT_INTERVAL_MS } from "@/utils/antiCheatConstants";

/**
 * Mounted once, at the app root (see App.vue, alongside useGameLoop) — owns
 * the fixed telemetry heartbeat and the window-level pointer listeners
 * pointerPhysics.ts needs. Everything else (click/purchase registration,
 * reading the restriction state) goes through useAntiCheatStore() directly
 * from wherever it's needed, the same way any other Pinia store is used.
 */
export function useAntiCheat() {
  const antiCheat = useAntiCheatStore();
  const game = useGameStore();
  const auth = useAuthStore();

  let timer: ReturnType<typeof setInterval> | null = null;

  async function heartbeatTick(): Promise<void> {
    const guestSaveReset = await antiCheat.sendHeartbeat();
    if (guestSaveReset) game.hardReset();
  }

  function onPointerMove(e: PointerEvent): void {
    antiCheat.onPointerMove(e);
  }
  function onPointerDown(e: PointerEvent): void {
    antiCheat.onPointerDown(e);
  }

  onMounted(() => {
    antiCheat.initialize();
    void antiCheat.fetchStatus();
    timer = setInterval(() => void heartbeatTick(), HEARTBEAT_INTERVAL_MS);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
  });

  onUnmounted(() => {
    if (timer !== null) clearInterval(timer);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
  });

  // A page loaded as a guest and then logging in mid-session must pick up
  // the server's authoritative status immediately, not wait for the next
  // heartbeat.
  watch(
    () => auth.isLoggedIn,
    (loggedIn) => {
      if (loggedIn) void antiCheat.fetchStatus();
    }
  );
}
