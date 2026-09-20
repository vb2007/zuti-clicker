import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { api, ApiError } from "@/lib/api";
import { pickWeightedBoosterId } from "@/utils/upgrades";
import { getBoosterEffectText } from "@/utils/boosterEffectText";
import {
  BOOSTER_DEFINITIONS,
  BOOSTER_SPAWN_MIN_SECS,
  BOOSTER_SPAWN_MAX_SECS,
  BOOSTER_VISIBLE_MIN_SECS,
  BOOSTER_VISIBLE_MAX_SECS
} from "@/utils/gameConstants";

/**
 * Random booster-pickup lifecycle: schedule a spawn, show it for a short
 * window (so it can be missed), and — on click — either roll it locally
 * (guest) or ask the server to grant one (logged in; see the anti-cheat
 * model in the plan this implements).
 *
 * The visual spawn schedule is always client-predicted, even for logged-in
 * players: the server is the sole authority on WHETHER a claim succeeds
 * (GameSave.nextBoosterAt), never on when a pickup is shown. Because both
 * draw from the same uniform(60s, 300s) distribution, a claim almost always
 * succeeds; the one case it can't is a schedule that's drifted out of sync
 * with the server (most commonly: reloading shortly after a claim on
 * another tab/device). That claim then 409s, costs the player nothing (see
 * claimPickup below), and the 409's nextAvailableInMs immediately re-syncs
 * the local schedule, so any drift self-corrects within one missed click.
 */
export function useBoosters() {
  const game = useGameStore();
  const auth = useAuthStore();
  const toast = useToastStore();
  const { t } = useI18n();

  function announce(boosterId: string): void {
    const name = t(`boosters.names.${boosterId}` as Parameters<typeof t>[0]);
    const def = BOOSTER_DEFINITIONS.find((d) => d.id === boosterId);
    const effect = getBoosterEffectText(t, def);
    // Falls back to the plain "activated!" toast if the id isn't one of
    // BOOSTER_DEFINITIONS (getBoosterEffectText returns "") — a client/
    // server BOOSTER_DEFINITIONS desync shouldn't render a toast with a
    // dangling "— " and nothing after it.
    const message = effect
      ? t("boosters.claimedToastWithEffect", { name, effect })
      : t("boosters.claimedToast", { name });
    toast.push("booster", message);
  }

  const pickupVisible = ref(false);
  const pickupPosition = ref<{ xPct: number; yPct: number }>({ xPct: 50, yPct: 30 });
  const visibleWindowMs = ref(0);

  let spawnTimer: ReturnType<typeof setTimeout> | null = null;
  let visibleTimer: ReturnType<typeof setTimeout> | null = null;

  function randomMs(minSecs: number, maxSecs: number): number {
    return (minSecs + Math.random() * (maxSecs - minSecs)) * 1000;
  }

  /**
   * Placement rejection-samples a point on the clicker area, expressed as a
   * percentage of its box, until it clears a circular "safe zone" around the
   * center (where the click circle and its hint text live) — so a pickup
   * never renders on top of the thing the player is trying to click.
   * Percentages (not pixels) so BoosterPickup.vue stays correct across any
   * clicker-area size without this composable measuring the DOM.
   */
  function randomSafePosition(): { xPct: number; yPct: number } {
    const SAFE_RADIUS_PCT = 30; // roughly covers the circle + hint + cps pill
    const MARGIN_PCT = 8; // keep the pickup fully inside with room to spare
    for (let attempt = 0; attempt < 20; attempt++) {
      const xPct = MARGIN_PCT + Math.random() * (100 - 2 * MARGIN_PCT);
      const yPct = MARGIN_PCT + Math.random() * (100 - 2 * MARGIN_PCT);
      const dx = xPct - 50;
      const dy = yPct - 50;
      if (Math.sqrt(dx * dx + dy * dy) >= SAFE_RADIUS_PCT) return { xPct, yPct };
    }
    // Fallback after repeated rejection (shouldn't happen at these ratios,
    // but never loop forever): a corner is always outside the safe zone.
    return { xPct: MARGIN_PCT, yPct: MARGIN_PCT };
  }

  function clearTimers(): void {
    if (spawnTimer !== null) {
      clearTimeout(spawnTimer);
      spawnTimer = null;
    }
    if (visibleTimer !== null) {
      clearTimeout(visibleTimer);
      visibleTimer = null;
    }
  }

  /** Schedules the next spawn. `delayMs`, when given, overrides the local random wait (used to re-sync after a claim/409). */
  function scheduleNextSpawn(delayMs?: number): void {
    if (spawnTimer !== null) clearTimeout(spawnTimer);
    const baseWait = randomMs(BOOSTER_SPAWN_MIN_SECS, BOOSTER_SPAWN_MAX_SECS);
    // departmentNewsletter shortens the average wait between spawns.
    const wait = delayMs ?? baseWait / game.boosterSpawnMultiplier;
    spawnTimer = setTimeout(showPickup, Math.max(0, wait));
  }

  function showPickup(): void {
    pickupPosition.value = randomSafePosition();
    visibleWindowMs.value = randomMs(BOOSTER_VISIBLE_MIN_SECS, BOOSTER_VISIBLE_MAX_SECS);
    pickupVisible.value = true;
    visibleTimer = setTimeout(missPickup, visibleWindowMs.value);
  }

  /** The player never clicked it in time — costs nothing but time (see module doc). */
  function missPickup(): void {
    pickupVisible.value = false;
    scheduleNextSpawn();
  }

  async function claimPickup(): Promise<void> {
    if (!pickupVisible.value) return;
    pickupVisible.value = false;
    if (visibleTimer !== null) {
      clearTimeout(visibleTimer);
      visibleTimer = null;
    }

    if (auth.isLoggedIn) {
      try {
        const res = await api.boosters.claim();
        game.grantBooster(res.boosterId, res.remainingMs);
        announce(res.boosterId);
        scheduleNextSpawn(res.nextAvailableInMs);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          // The local schedule fired slightly ahead of the server's actual
          // cooldown (see module doc) — no tokens or progress are at stake,
          // just re-sync from the server's own remaining time.
          const body = e.body as { nextAvailableInMs?: number } | undefined;
          scheduleNextSpawn(body?.nextAvailableInMs);
        } else {
          // Anything else (expired session, network failure, server error)
          // is a real problem the player should be told about, not silently
          // retried forever — same "surface it, don't swallow it" pattern
          // saveStore/SettingsModal already use for a failed sync.
          toast.push("error", t("boosters.claimFailed"));
          scheduleNextSpawn();
        }
      }
    } else {
      // Guest: fully local, matching the server's own weighting/duration
      // logic (see utils/upgrades.ts) so play feels identical either way.
      const boosterId = pickWeightedBoosterId();
      const def = BOOSTER_DEFINITIONS.find((d) => d.id === boosterId);
      const durationMs = (def?.durationSecs ?? 0) * 1000 * game.boosterDurationMultiplier;
      game.grantBooster(boosterId, durationMs);
      announce(boosterId);
      scheduleNextSpawn();
    }
  }

  onMounted(() => scheduleNextSpawn());
  onUnmounted(() => clearTimers());

  return { pickupVisible, pickupPosition, visibleWindowMs, claimPickup };
}
