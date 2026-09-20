<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { useGameStore } from "@/stores/gameStore";
import type { ClickMethod } from "@/utils/clickTelemetry";

const { t } = useI18n();
const antiCheat = useAntiCheatStore();
const game = useGameStore();

const emit = defineEmits<{ click: [payload: { x: number; y: number }] }>();

const circleRef = ref<HTMLElement | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);

// The circle is "pressed" (scaled down, glowing) for a short hold that every
// click refreshes — not a keyframe restarted per click. An earlier version
// force-restarted a fixed-duration keyframe on every click (remove the class,
// force a reflow, re-add it), then rate-limited that restart to avoid rapid
// clicking strobing the flash; both were the wrong shape for the problem —
// throttling the restart meant most clicks under fast spam produced no
// visible feedback at all, right back to the original "out of sync" bug.
// Modeled on how Cookie Clicker's own cookie behaves instead: it doesn't
// replay an animation per click, it just stays visually pressed for as long
// as clicks keep arriving, and eases back only once they stop. Concretely:
// entering "pressed" is a CSS *transition* (not a keyframe), so calling this
// again while already pressed is a no-op — nothing to restart — and each
// call simply pushes the release timer back out, extending the hold.
const PRESS_HOLD_MS = 150;
let releaseTimer: ReturnType<typeof setTimeout> | null = null;
function press() {
  const el = circleRef.value;
  if (!el) return;
  el.classList.add("circle-pressed");
  if (releaseTimer) clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => el.classList.remove("circle-pressed"), PRESS_HOLD_MS);
}

// Concentric pulse rings as keyed, self-removing entries (same pattern
// ClickerArea already uses for floating numbers), so overlapping clicks each
// get their own ring that plays to completion instead of one ring fighting a
// restart. Capped so spam-clicking can't grow the DOM without bound. Each
// ring is a brand-new element playing its own animation once, so — unlike
// the circle's own press state — there's no shared restart to throttle here.
const MAX_RINGS = 6;
const RING_LIFETIME_MS = 400;
const rings = ref<{ id: number }[]>([]);
let ringUid = 0;
function spawnRing() {
  const id = ringUid++;
  if (rings.value.length >= MAX_RINGS) rings.value.shift();
  rings.value.push({ id });
  setTimeout(() => {
    const i = rings.value.findIndex((r) => r.id === id);
    if (i !== -1) rings.value.splice(i, 1);
  }, RING_LIFETIME_MS);
}

function registerClick(x: number, y: number) {
  emit("click", { x, y });
  press();
  spawnRing();
}

/**
 * The one gate every click (pointer or keyboard) funnels through before
 * registering — see stores/antiCheatStore.ts. A hidden/unfocused document
 * never delivers real input to begin with, so that check runs first and
 * doesn't even count toward the untrusted-click telemetry. `trusted` MUST be
 * the original event's own `isTrusted`, never re-derived: a script
 * dispatching a synthetic click through this handler is exactly what that
 * flag exists to catch, and it earns nothing, silently.
 */
function attemptClick(trusted: boolean, method: ClickMethod, x: number, y: number): void {
  // While restricted, a click must behave like a disabled button — no press
  // animation, no floating "+0", no advance of the CPS readout — not a
  // click that silently earns nothing while still looking like it landed.
  // gameStore.clickToken() itself is also gated (belt-and-braces: it can't
  // be bypassed by calling the store directly), but that alone would let a
  // "+0" popup and a moving CPS number through, which is exactly what a
  // restricted player should NOT see.
  if (antiCheat.isRestricted) return;
  if (document.hidden || !document.hasFocus()) {
    antiCheat.recordHiddenClick();
    return;
  }
  const outcome = antiCheat.recordClick(trusted, method);
  if (!outcome.credited) {
    // A guest's 5th strike has no server save to reset — see recordClick's
    // own comment on why that's this caller's job, not the store's.
    if (outcome.guestSaveReset) game.hardReset();
    return;
  }
  registerClick(x, y);
}

// A single click must count once, however it was triggered — pointerdown
// (mouse/touch/pen) or a keyboard Enter/Space activating the native <button>.
// pointerdown handles the pointer case immediately (snappier under spam than
// waiting for pointerup/click), so the "click" event the browser fires right
// after (for a real pointer press) must not also register it.
//
// This used to be guarded by a flag cleared on a 0ms timeout, which was a
// real bug: that clear is racing the browser's own click dispatch, and on
// real hardware (unlike a synchronous test simulation) there is no guarantee
// click fires before the timeout — when it lost the race, the flag was
// already cleared and the click counted a second time, visibly doubling
// every gain. `MouseEvent.detail` sidesteps the race entirely: it's 0 for a
// keyboard/synthetic activation and >=1 for a real pointer-originated click
// (a stable, spec-backed distinction — the browser sets it directly on the
// event, nothing here has to race or track it), so no timer or flag at all.
function handlePointerDown(e: PointerEvent) {
  // Only the primary (left) and secondary (right) buttons earn a token;
  // middle/back/forward are ignored so autoscroll and browser navigation
  // gestures still work when they happen to land on the circle.
  if (e.button !== 0 && e.button !== 2) return;
  attemptClick(e.isTrusted, e.button === 0 ? "primary" : "secondary", e.clientX, e.clientY);
}

function handleClick(e: MouseEvent) {
  if (e.detail !== 0) return; // a real pointer click — pointerdown already handled it
  // Keyboard-triggered activation: MouseEvent.clientX/Y are 0 for a
  // synthetic click, so anchor the floating number to the circle's own
  // center instead of the viewport origin.
  const rect = wrapperRef.value?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : e.clientX;
  const y = rect ? rect.top + rect.height / 2 : e.clientY;
  attemptClick(e.isTrusted, "keyboard", x, y);
}
</script>

<template>
  <button
    ref="wrapperRef"
    type="button"
    class="circle-wrap"
    :aria-label="t('clicker.ariaLabel')"
    @pointerdown="handlePointerDown"
    @click="handleClick"
    @contextmenu.prevent
    @dragstart.prevent
  >
    <!-- idle hover rings -->
    <div class="ring ring-1"></div>
    <div class="ring ring-2"></div>

    <!-- per-click pulse bursts -->
    <template v-for="r in rings" :key="r.id">
      <div class="ring ring-1 ring-burst"></div>
      <div class="ring ring-2 ring-burst"></div>
    </template>

    <!-- ambient glow, isolated from the click-pop animation so the two never
         fight over the `animation` shorthand on the same element -->
    <div class="glow-layer" aria-hidden="true"></div>

    <div ref="circleRef" class="circle">
      <div class="circle-inner">
        <img
          src="@/assets/images/zutiy.jpg"
          alt="Dr. Zuti Pál, Digitális kor győztese"
          draggable="false"
        />
      </div>
    </div>
  </button>
</template>

<style scoped>
.circle-wrap {
  position: relative;
  width: 220px;
  height: 220px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  padding: 0;
}

.glow-layer {
  position: absolute;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  pointer-events: none;
  animation: breathe 3.5s ease-in-out infinite;
}

.circle {
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 38%, var(--bg-elevated), var(--bg-card));
  border: 2px solid var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  /* One transition duration/easing governs both directions (entering and
     leaving .circle-pressed) rather than one per state — which side "wins"
     when a class toggle changes both the property and its own transition is
     inconsistent across browsers, so this sidesteps that entirely. An
     exponential ease-out (decelerate smoothly, no overshoot) rather than a
     bounce/elastic curve, which reads as dated rather than snappy. */
  transition:
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 150ms ease,
    border-color var(--transition-fast);
  position: relative;
  z-index: 1;
}

.circle-wrap:hover .circle {
  border-color: var(--accent-text);
  box-shadow:
    0 0 48px var(--accent-glow),
    0 0 80px var(--accent-glow);
}

.circle.circle-pressed {
  transform: scale(0.91);
  box-shadow: 0 0 64px var(--accent-glow);
}

.circle-inner {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.circle-inner img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  -webkit-user-drag: none;
  user-select: none;
  pointer-events: none;
}

/* rings */
.ring {
  position: absolute;
  border-radius: 50%;
  border: 1px solid var(--accent);
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-base);
}

.ring-1 {
  width: 224px;
  height: 224px;
}
.ring-2 {
  width: 250px;
  height: 250px;
}

.circle-wrap:hover .ring-1 {
  opacity: 0.25;
}
.circle-wrap:hover .ring-2 {
  opacity: 0.1;
}

.ring-burst {
  animation: pulseRing 0.4s ease-out both;
}

@media (prefers-reduced-motion: reduce) {
  /* Drop the squish transform; the glow burst (box-shadow, not motion)
     still confirms the click. */
  .circle {
    transition: box-shadow 150ms ease, border-color var(--transition-fast);
  }
  .circle.circle-pressed {
    transform: none;
  }
}
</style>
