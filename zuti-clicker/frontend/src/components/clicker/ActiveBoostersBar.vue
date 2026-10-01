<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { BOOSTER_DEFINITIONS } from "@/utils/gameConstants";
import { getBoosterEffectText } from "@/utils/boosterEffectText";

const { t } = useI18n();
const game = useGameStore();

// A 1Hz ticking clock, local to this component — gameStore's own expiry
// sweep (see gameStore.tick()) only reassigns activeBoosters when something
// actually expires, which is correct for the multiplier computeds but not
// frequent enough to drive a live "0:42" countdown by itself.
const now = ref(Date.now());
let intervalId: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  intervalId = setInterval(() => {
    now.value = Date.now();
  }, 1000);
});
onUnmounted(() => {
  if (intervalId !== null) clearInterval(intervalId);
});

const pills = computed(() =>
  game.activeBoosters
    .map((b) => {
      const def = BOOSTER_DEFINITIONS.find((d) => d.id === b.id);
      const remainingSecs = Math.max(0, Math.ceil((b.expiresAt - now.value) / 1000));
      return { id: b.id, kind: def?.kind, effect: getBoosterEffectText(t, def), remainingSecs };
    })
    .filter((p) => p.remainingSecs > 0)
);

function formatCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
</script>

<template>
  <div v-if="pills.length > 0" class="boosters-bar" role="status" aria-live="polite">
    <div v-for="p in pills" :key="p.id" class="booster-chip" :class="p.kind">
      <span class="chip-icon" aria-hidden="true">⚡</span>
      <span class="chip-label">{{ t(`boosters.names.${p.id}`) }}</span>
      <!-- p.effect is "" if this booster id isn't in BOOSTER_DEFINITIONS
           (a client/server desync) — skip the separator too, rather than a
           dangling "Name · " with nothing after it. -->
      <template v-if="p.effect">
        <span class="chip-sep" aria-hidden="true">·</span>
        <span class="chip-effect">{{ p.effect }}</span>
      </template>
      <span class="chip-time">{{ formatCountdown(p.remainingSecs) }}</span>
    </div>
  </div>
</template>

<style scoped>
.boosters-bar {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  z-index: 260;
  pointer-events: none;
  max-width: calc(100% - 24px);
}

/* A narrow area (phone portrait): three simultaneous boosters, each as wide as
   "Name · effect  0:42", stack into three rows and land on the circle. Drop the
   name (the effect is the useful part) and tighten up so two fit per row and the
   bar stays above the circle. */
@container (max-width: 420px) {
  .boosters-bar {
    gap: 4px;
    top: 8px;
  }
  .booster-chip {
    gap: 4px;
    padding: 3px 8px;
  }
  .chip-label,
  .chip-sep {
    display: none;
  }
}

/* Short screen (phone landscape): the circle fills the area's height, so a bar centred
   above it would sit on top of it. Park the chips down the left side instead, and let
   them use only the room beside the circle — the effect text is ellipsized to fit
   (the time always stays), rather than a long Hungarian effect reaching the circle. The
   name is dropped; the effect is the useful part. */
@media (max-height: 500px) {
  .boosters-bar {
    left: 12px;
    transform: none;
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: flex-start;
    justify-content: flex-start;
    max-width: max(64px, calc((100% - var(--circle, 220px)) / 2 - 20px));
  }
  .booster-chip {
    max-width: 100%;
  }
  .chip-label,
  .chip-sep {
    display: none;
  }
  .chip-effect {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip-icon,
  .chip-time {
    flex: none;
  }
}

.booster-chip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-full);
  background: var(--bg-surface);
  border: 1px solid var(--booster);
  box-shadow: 0 0 10px var(--booster-glow);
  animation: fadeScaleIn 200ms ease both;
}

.chip-icon {
  font-size: 11px;
  color: var(--booster);
}

.chip-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}

.chip-sep {
  font-size: 11px;
  color: var(--text-muted);
}

.chip-effect {
  font-size: 11px;
  font-weight: 600;
  color: var(--booster);
  white-space: nowrap;
}

.chip-time {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
