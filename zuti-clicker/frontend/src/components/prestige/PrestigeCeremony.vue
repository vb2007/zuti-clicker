<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useUiStore } from "@/stores/uiStore";
import { usePrestige } from "@/composables/usePrestige";
import { useOverlay } from "@/composables/useOverlayStack";

const { t, locale } = useI18n();
const ui = useUiStore();
const { dismissCeremony } = usePrestige();

const displayedGain = ref(0);
const settled = ref(false);
let rafId: number | null = null;

// Exponential ease-out count-up: fast at first, settling in — the number
// itself is the one authored moment here, so nothing else competes with it.
function animateCount(target: number, durationMs: number) {
  const start = performance.now();
  function step(now: number) {
    const elapsed = now - start;
    const t = Math.min(1, elapsed / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    displayedGain.value = Math.round(eased * target);
    if (t < 1) {
      rafId = requestAnimationFrame(step);
    } else {
      displayedGain.value = target;
      settled.value = true;
    }
  }
  rafId = requestAnimationFrame(step);
}

onMounted(() => {
  animateCount(ui.lastPrestigeGain, 900);
});

// Back / Escape continue, exactly like the button — but only once it is
// offered: during the count-up they are refused (the overlay stack re-arms
// Back), so a stray press can't skip the one authored moment.
useOverlay(
  () => true,
  () => {
    if (settled.value) dismissCeremony();
  }
);

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
});
</script>

<template>
  <Teleport to="body">
    <div class="ceremony-backdrop">
      <!-- Own clipping box: the pulsing rings scale far past the screen, and
           must not add scrollable overflow to the (scrollable) backdrop. -->
      <div class="rings" aria-hidden="true">
        <div class="ring ring-1"></div>
        <div class="ring ring-2"></div>
        <div class="ring ring-3"></div>
      </div>

      <div class="ceremony-content">
        <div class="cap" aria-hidden="true">🎓</div>
        <div class="gain-number">+{{ displayedGain.toLocaleString(locale) }}</div>
        <div class="gain-label">{{ t("prestige.ceremonyGained") }}</div>
        <p class="subtext">{{ t("prestige.ceremonySubtext") }}</p>

        <!-- Always laid out (hidden until the count-up settles), so its arrival
             neither shifts the centred content nor pushes it off a short screen.
             visibility: hidden also keeps it out of the Tab order meanwhile. -->
        <button
          class="continue-btn"
          :class="{ pending: !settled }"
          @click="dismissCeremony"
        >
          {{ t("prestige.continueBtn") }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ceremony-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  background: var(--bg-base);
  animation: fadeIn 320ms ease;
  /* Scrolls when the content is taller than the screen (phone landscape), so
     the Continue button can never be out of reach. */
  overflow-y: auto;
  padding: var(--sai-top) var(--sai-right) var(--sai-bottom) var(--sai-left);
}

.rings {
  position: fixed;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  border: 1px solid var(--accent);
  transform: translate(-50%, -50%) scale(1);
  opacity: 0;
  animation: ceremonyPulse 2.6s ease-out infinite;
}
.ring-2 { animation-delay: 0.7s; }
.ring-3 { animation-delay: 1.4s; }

@keyframes ceremonyPulse {
  0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0.5; }
  100% { transform: translate(-50%, -50%) scale(3.2); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  @keyframes ceremonyPulse {
    0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
  }
}

.ceremony-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px;
  /* auto margins centre it while it fits and let it start at the top (instead
     of being cut off above the fold) once it doesn't. */
  margin: auto;
}

.cap {
  font-size: 48px;
  animation: fadeScaleIn 500ms ease both;
  margin-bottom: 8px;
}

.gain-number {
  /* Grows with the viewport but never past 72px — a 7-digit gain overflowed a
     320px screen at the fixed size. */
  font-size: clamp(44px, 14vw, 72px);
  max-width: 100%;
  font-weight: 900;
  color: var(--accent);
  letter-spacing: -2px;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 48px var(--accent-glow);
  line-height: 1;
}

.gain-label {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: var(--text-muted);
  margin-top: 10px;
}

.subtext {
  margin-top: 20px;
  max-width: 380px;
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.continue-btn {
  margin-top: 36px;
  min-height: 44px;
  padding: 12px 28px;
  border-radius: var(--radius-sm);
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
  font-size: 14px;
  font-weight: 700;
  transition: filter var(--transition-fast);
}
@media (hover: hover) {
  .continue-btn:hover {
    filter: brightness(1.1);
  }
}

.continue-btn {
  transition:
    opacity 320ms ease,
    transform 320ms ease,
    filter var(--transition-fast);
}
.continue-btn.pending {
  visibility: hidden;
  opacity: 0;
  transform: translateY(10px);
}

/* Phone landscape: ~330px of height for everything. */
@media (max-height: 480px) {
  .ceremony-content {
    padding-block: 12px;
  }
  .cap {
    font-size: 32px;
    margin-bottom: 4px;
  }
  .gain-number {
    font-size: clamp(40px, 16dvh, 56px);
  }
  .gain-label {
    margin-top: 6px;
  }
  .subtext {
    margin-top: 10px;
    font-size: 13px;
    line-height: 1.45;
  }
  .continue-btn {
    margin-top: 16px;
  }
}
</style>
