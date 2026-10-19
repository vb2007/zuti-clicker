import { onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { useSaveStore, SyncFlushError } from "@/stores/saveStore";
import { api, ApiError, type ClaimBoosterResponse } from "@/lib/api";
import { pickWeightedBoosterId } from "@/utils/upgrades";
import { getWindfallGrant } from "@/utils/careerEconomy";
import { CAREER_CAPS } from "@/utils/careerCore";
import { formatNumber } from "@/utils/formatters";
import { randomSafePosition, DEFAULT_LAYOUT, type PlacementLayout } from "@/utils/boosterPlacement";
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
export function useBoosters(getLayout?: () => PlacementLayout | null) {
  const game = useGameStore();
  const auth = useAuthStore();
  const toast = useToastStore();
  const save = useSaveStore();
  const { t } = useI18n();

  function announce(boosterId: string, granted?: number): void {
    const name = t(`boosters.names.${boosterId}` as Parameters<typeof t>[0]);
    const def = BOOSTER_DEFINITIONS.find((d) => d.id === boosterId);
    const effect =
      granted !== undefined
        ? t("boosters.effect.instantAmount", { amount: formatNumber(granted) })
        : getBoosterEffectText(t, def, game.careerModifiers);
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
    // departmentNewsletter and the Academic Career shorten the average wait
    // between spawns (the same capped divisor and floor the server applies).
    const wait =
      delayMs ??
      Math.max(
        CAREER_CAPS.boosterCooldownFloorSecs * 1000,
        baseWait / game.boosterSpawnMultiplier
      );
    spawnTimer = setTimeout(showPickup, Math.max(0, wait));
  }

  function showPickup(): void {
    // Nothing spawns while the Academic Career purchase window is open — the
    // game is paused behind it, and a buff would only burn down unused.
    if (game.careerWindowOpen) {
      scheduleNextSpawn();
      return;
    }
    // Measured at spawn time (not cached): the area and circle resize with the
    // viewport, and a pickup must clear the circle as it is *now*.
    pickupPosition.value = randomSafePosition(getLayout?.() ?? DEFAULT_LAYOUT);
    // Poster Session nodes keep a pickup on screen longer.
    visibleWindowMs.value =
      randomMs(BOOSTER_VISIBLE_MIN_SECS, BOOSTER_VISIBLE_MAX_SECS) * game.boosterWindowMultiplier;
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
        // Once the Academic Career unlocked windfall, a claim may come back as
        // an instant token grant the server credits to the save itself — so,
        // like an Upgrader spin, the save is flushed first and no other save
        // goes out until the grant has been applied here (an in-between save
        // would carry the old balance and an outdated counter).
        const claim = (): Promise<ClaimBoosterResponse> => api.boosters.claim();
        let applied = false;
        const res = game.careerModifiers.unlockedBoosters.includes("windfall")
          ? await save.withSyncLock(async () => {
              const r = await claim();
              if (r.windfall) game.applyWindfall(r.windfall.granted, r.windfall.upgraderSeq);
              applied = true;
              return r;
            })
          : await claim();
        // A windfall can come back even without the lock (this tab's tree was
        // out of date — another tab unlocked it): the server has credited it
        // either way, so it is applied either way.
        if (res.windfall && !applied) {
          game.applyWindfall(res.windfall.granted, res.windfall.upgraderSeq);
        }
        if (res.windfall) {
          announce(res.boosterId, res.windfall.granted);
        } else {
          game.grantBooster(res.boosterId, res.remainingMs);
          announce(res.boosterId);
        }
        scheduleNextSpawn(res.nextAvailableInMs);
      } catch (e) {
        if (e instanceof SyncFlushError) {
          // The pre-claim save couldn't be made (a stale save has already
          // reloaded and said so) — nothing was claimed; try again later.
          if (!e.stale) toast.push("error", t("boosters.claimFailed"));
          scheduleNextSpawn();
        } else if (e instanceof ApiError && e.status === 409) {
          // The local schedule fired slightly ahead of the server's actual
          // cooldown (see module doc) — no tokens or progress are at stake,
          // just re-sync from the server's own remaining time.
          const body = e.body as { nextAvailableInMs?: number } | undefined;
          scheduleNextSpawn(body?.nextAvailableInMs);
        } else if (e instanceof ApiError && e.status === 403) {
          // lib/api.ts's shared interceptor already applied this to
          // antiCheatStore and the warning modal is now showing — a second,
          // generic "couldn't claim" toast on top of it would only confuse
          // what's actually a very specific, already-explained situation.
          scheduleNextSpawn();
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
      const boosterId = pickWeightedBoosterId(Math.random, game.careerModifiers);
      const def = BOOSTER_DEFINITIONS.find((d) => d.id === boosterId);
      if (def?.kind === "instant") {
        const granted = getWindfallGrant(
          game.unitStates.map((u) => ({ unitId: u.id, owned: u.owned })),
          game.phdCount,
          game.careerModifiers
        );
        game.applyWindfall(granted);
        announce(boosterId, granted);
      } else {
        const durationMs = (def?.durationSecs ?? 0) * 1000 * game.boosterDurationMultiplier;
        game.grantBooster(boosterId, durationMs);
        announce(boosterId);
      }
      scheduleNextSpawn();
    }
  }

  onMounted(() => scheduleNextSpawn());
  onUnmounted(() => clearTimers());

  return { pickupVisible, pickupPosition, visibleWindowMs, claimPickup };
}
