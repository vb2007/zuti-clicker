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
      return { id: b.id, kind: def?.kind, effect: getBoosterEffectText(t, b.id), remainingSecs };
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
      <span class="chip-sep" aria-hidden="true">·</span>
      <span class="chip-effect">{{ p.effect }}</span>
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
