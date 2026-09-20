<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { CPS_WINDOW_MS } from "@/utils/gameConstants";
import ClickerCircle from "./ClickerCircle.vue";
import FloatingNumber from "./FloatingNumber.vue";
import BoosterPickup from "./BoosterPickup.vue";
import ActiveBoostersBar from "./ActiveBoostersBar.vue";
import { useBoosters } from "@/composables/useBoosters";

const { t } = useI18n();
const game = useGameStore();
const { pickupVisible, pickupPosition, visibleWindowMs, claimPickup } = useBoosters();

interface FloatEntry {
  id: number;
  x: number;
  y: number;
  amount: number;
  crit: boolean;
}

const floats = ref<FloatEntry[]>([]);
let uid = 0;

// Rolling clicks-per-second readout: a timestamp per click, pruned to the
// last CPS_WINDOW_MS. Replaces the old tokens-per-second pill here — TPS is
// already shown in StatusColumn (desktop) and AppHeader's mini-stats
// (<760px); this is the one number that belongs next to the circle and
// isn't shown anywhere else.
const clickTimestamps = ref<number[]>([]);
const cps = ref(0);

// Pruning (and therefore decaying `cps` back toward 0) only happened inside
// onCircleClick, so it never re-ran once the player stopped clicking — the
// pill would freeze at its last value instead of disappearing. A light
// interval keeps it live regardless of whether new clicks are coming in.
function recomputeCps(): void {
  const cutoff = performance.now() - CPS_WINDOW_MS;
  while (clickTimestamps.value.length > 0 && clickTimestamps.value[0]! < cutoff) {
    clickTimestamps.value.shift();
  }
  cps.value = clickTimestamps.value.length / (CPS_WINDOW_MS / 1000);
}

let cpsInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  cpsInterval = setInterval(recomputeCps, 250);
});
onUnmounted(() => {
  if (cpsInterval !== null) clearInterval(cpsInterval);
});

function onCircleClick({ x, y }: { x: number; y: number }) {
  const { earned, crit } = game.clickToken();
  const id = uid++;
  floats.value.push({
    id,
    x: x + (Math.random() * 36 - 18),
    y: y - 16,
    amount: earned,
    crit
  });
  setTimeout(() => {
    const i = floats.value.findIndex((f) => f.id === id);
    if (i !== -1) floats.value.splice(i, 1);
  }, 780);

  clickTimestamps.value.push(performance.now());
  recomputeCps();
}
</script>

<template>
  <main class="clicker-area">
    <div class="glow-bg" aria-hidden="true"></div>

    <ActiveBoostersBar />

    <div class="clicker-content">
      <ClickerCircle @click="onCircleClick" />

      <p class="hint">{{ t("clicker.hint") }}</p>

      <!-- Always rendered (fixed height, matching .cps-pill's own height) so
           the pill's v-if mount/unmount never changes .clicker-content's
           total height — see the regression test for why this exists: the
           circle used to visibly shift up/down as this pill appeared. -->
      <div class="cps-slot">
        <Transition name="cps-fade">
          <div v-if="cps > 0" class="cps-pill">
            <span class="cps-val">{{ cps.toFixed(1) }}</span>
            <span class="cps-unit">{{ t("clicker.cps") }}</span>
          </div>
        </Transition>
      </div>
    </div>

    <BoosterPickup
      v-if="pickupVisible"
      :x-pct="pickupPosition.xPct"
      :y-pct="pickupPosition.yPct"
      :visible-ms="visibleWindowMs"
      @claim="claimPickup"
    />

    <Teleport to="body">
      <FloatingNumber
        v-for="f in floats"
        :key="f.id"
        :x="f.x"
        :y="f.y"
        :amount="f.amount"
        :crit="f.crit"
      />
    </Teleport>
  </main>
</template>

<style scoped>
.clicker-area {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
  overflow: hidden;
  transition: background var(--transition-slow);
}

.glow-bg {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse 55% 45% at 50% 50%, var(--accent-glow), transparent 70%);
  pointer-events: none;
  opacity: 0.35;
}

.clicker-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  position: relative;
  z-index: 1;
}

.hint {
  font-size: 13px;
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.2px;
  user-select: none;
}

/* Fixed height, equal to .cps-pill's own height (box-sizing: border-box
   from the global reset, so the border is included in that 28px, not added
   on top) — this is what keeps the two locked in step as font/padding
   evolve, rather than duplicating a magic number in two places. */
.cps-slot {
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cps-pill {
  height: 28px;
  display: flex;
  align-items: center;
  gap: 3px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  padding: 0 16px;
}

.cps-val {
  font-size: 15px;
  font-weight: 800;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.cps-unit {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

.cps-fade-enter-active,
.cps-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.cps-fade-enter-from,
.cps-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
