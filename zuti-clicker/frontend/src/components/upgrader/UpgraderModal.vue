<!--
  THESIS: the wheel IS the odds. The amber arc is exactly the chance of winning
  (drawn from the same integer ppm the server rolls against) and the spin lands
  on the server's own roll — no staged near-misses. Refuses a casino modal: no
  confetti, no glow, no jackpot copy; PhDs are earned, so this reads as a
  decision, not a prize.
  OWN-WORLD: inherited, not invented — BaseModal shell, base.css tokens,
  --booster as the one rare accent (the win arc), the .seg-btn segmented control
  from the leaderboard/shop, fadeScaleIn for the single result reveal.
  STORY: see the real odds and both outcomes before committing, choose a stake
  and multiplier, spin once, read the result, decide whether to go again.
  FIRST VIEWPORT: wheel centred (chance in the hub), the Win / Lose outcome pair
  directly under it doubling as the legend, controls below, one full-width Spin.
  FORM: operate-mode extension of an established surface; no concept round.
-->
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useAuthStore } from "@/stores/authStore";
import { useUiStore } from "@/stores/uiStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { useUpgrader } from "@/composables/useUpgrader";
import { useBreakpoint } from "@/composables/useBreakpoint";
import {
  toHundredths,
  quoteSpin,
  minStake,
  consolationMs,
  sliderToMultiplier,
  multiplierToSlider,
  type SpinOutcome
} from "@/utils/upgrader";
import { formatChancePpm } from "@/utils/formatters";
import {
  UPGRADER_PPM,
  UPGRADER_RTP,
  UPGRADER_WIN_CHANCE_CAP,
  UPGRADER_PRESET_MULTIPLIERS,
  UPGRADER_CONSOLATION_BOOSTER_ID
} from "@/utils/gameConstants";
import BaseModal from "@/components/modals/BaseModal.vue";

const { t, locale } = useI18n();
// PhDs are whole numbers being staked and compared against, so they are shown
// exactly ("1,999"), never abbreviated ("2.00K" would read as 2,000 — a stake the
// player can't actually place).
const fmt = (n: number): string => n.toLocaleString(locale.value);
const game = useGameStore();
const auth = useAuthStore();
const ui = useUiStore();
const antiCheat = useAntiCheatStore();
const upgrader = useUpgrader();
// A phone: tighter modal padding so the whole bet fits above the fold.
// Matches the @media (max-width: 480px) block below.
const { isCompact: isPhone } = useBreakpoint(481);

// idle: choosing · requesting: waiting on the server (the pre-spin save flush
// plus the spin itself) · spinning: the wheel is turning · settled: result shown.
type Phase = "idle" | "requesting" | "spinning" | "settled";
const phase = ref<Phase>("idle");
const busy = computed(() => phase.value === "requesting" || phase.value === "spinning");

const SPIN_MS = 3200;
const SPIN_TURNS = 5;
const INT32_MAX = 2_147_483_647; // keep in sync with api/src/constants/upgrader.ts
const STAKE_PERCENTS = [10, 25, 50, 100] as const;

const multiplier = ref(2);
const stakeText = ref("");
const outcome = ref<SpinOutcome | null>(null);
// What the bet looked like when it was placed — the tiles and the result line
// describe THIS, not whatever the controls say once the balance has moved.
const placed = ref<{ stake: number; gain: number; frenzyMs: number } | null>(null);
const rotation = ref(0);
const wheelEl = ref<SVGSVGElement | null>(null);
const spinBtn = ref<HTMLButtonElement | null>(null);
let settleTimer: ReturnType<typeof setTimeout> | null = null;

const owned = computed(() => game.phdCount);
const stake = computed(() => (/^\d+$/.test(stakeText.value) ? Number(stakeText.value) : NaN));
const hundredths = computed(() => toHundredths(multiplier.value));
const quote = computed(() =>
  hundredths.value === null || !Number.isInteger(stake.value)
    ? null
    : quoteSpin(stake.value, hundredths.value)
);

function formatMult(m: number): string {
  return m.toFixed(2).replace(/\.?0+$/, "");
}

const problem = computed<string | null>(() => {
  if (antiCheat.isRestricted) return t("upgrader.problems.restricted");
  if (owned.value < 1) return t("upgrader.problems.noPhd");
  if (!(stake.value >= 1)) return t("upgrader.problems.enterStake");
  if (stake.value > owned.value) {
    return t("upgrader.problems.tooMany", { owned: fmt(owned.value) });
  }
  if (quote.value === null) {
    return t("upgrader.problems.tooSmall", {
      min: fmt(minStake(hundredths.value ?? 120)),
      mult: formatMult(multiplier.value)
    });
  }
  if (owned.value - stake.value + quote.value.payout > INT32_MAX) {
    return t("upgrader.errors.limit");
  }
  return null;
});

const canSpin = computed(() => problem.value === null && !busy.value);

// The wheel and tiles show the placed bet while one is in flight or settled,
// and the live bet while choosing.
const shown = computed(() => {
  if (placed.value && outcome.value) {
    return {
      winPpm: outcome.value.winPpm,
      gain: placed.value.gain,
      stake: placed.value.stake,
      frenzyMs: placed.value.frenzyMs
    };
  }
  if (quote.value === null || !Number.isInteger(stake.value)) return null;
  return {
    winPpm: quote.value.winPpm,
    gain: quote.value.payout - stake.value,
    stake: stake.value,
    frenzyMs: consolationMs(stake.value, owned.value)
  };
});

// pathLength="100" on the circle makes the dash exactly the percentage.
const winDash = computed(() => (shown.value ? (shown.value.winPpm / UPGRADER_PPM) * 100 : 0));
const winPct = computed(() => (shown.value ? formatChancePpm(shown.value.winPpm) : null));
const losePct = computed(() =>
  shown.value ? formatChancePpm(UPGRADER_PPM - shown.value.winPpm) : null
);
const frenzyName = computed(() =>
  t(`boosters.names.${UPGRADER_CONSOLATION_BOOSTER_ID}` as Parameters<typeof t>[0])
);
const wheelAria = computed(() => t("upgrader.wheelAria", { pct: winPct.value ?? "0" }));
// 200 steps along the log scale, not 1000: a keyboard user gets a usable stride
// (about 0.9% of the multiplier per key press) instead of hundreds of presses.
const SLIDER_STEP = 5;
const sliderPosition = computed(
  () => Math.round((multiplierToSlider(multiplier.value) * 1000) / SLIDER_STEP) * SLIDER_STEP
);

// What sits under the result: the reason the bet can't be spun again, if there
// is one (all PhDs lost, the stake now above what's left), else the frenzy line.
// Without this the button would just go grey with no explanation.
// The return / cap disclosure fills the status slot whenever there is nothing
// more urgent to say — which is exactly the moment before a spin, when it matters.
const showFinePrint = computed(
  () => resultLine.value === null && !(phase.value === "idle" && problem.value !== null)
);

const statusSub = computed(() => problem.value ?? resultLine.value?.sub ?? "");

const spinLabel = computed(() => {
  if (busy.value) return t("upgrader.spinning");
  return phase.value === "settled" && canSpin.value ? t("upgrader.spinAgain") : t("upgrader.spin");
});

const resultLine = computed(() => {
  const o = outcome.value;
  const p = placed.value;
  if (phase.value !== "settled" || !o || !p) return null;
  if (o.won) {
    return {
      won: true,
      main: t("upgrader.resultWin", { gain: fmt(p.gain) }),
      sub: t("upgrader.resultWinTotal", { total: fmt(o.phdCount) })
    };
  }
  return {
    won: false,
    main: t("upgrader.resultLose", { stake: fmt(p.stake) }),
    sub: o.consolation
      ? t("upgrader.resultFrenzy", {
          name: frenzyName.value,
          seconds: Math.ceil(o.consolation.remainingMs / 1000)
        })
      : ""
  };
});

function defaultStake(): string {
  if (owned.value < 1) return "";
  const floor = minStake(hundredths.value ?? 120);
  return String(Math.min(owned.value, Math.max(floor, Math.floor(owned.value / 10))));
}

function setStakePercent(p: number): void {
  if (owned.value < 1) return;
  const share = Math.max(1, Math.floor((owned.value * p) / 100));
  stakeText.value = String(p === 100 ? owned.value : share);
}

function onStakeInput(e: Event): void {
  stakeText.value = (e.target as HTMLInputElement).value.replace(/\D/g, "").slice(0, 10);
}

function onSlider(e: Event): void {
  multiplier.value = sliderToMultiplier(Number((e.target as HTMLInputElement).value) / 1000);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

function clearTimer(): void {
  if (settleTimer !== null) {
    clearTimeout(settleTimer);
    settleTimer = null;
  }
}

function settle(): void {
  if (phase.value !== "spinning") return;
  clearTimer();
  phase.value = "settled";
  upgrader.releaseReveal();
}

function onTransitionEnd(e: TransitionEvent): void {
  // The wheel's own turn only — the win arc's dash morph also bubbles up here.
  if (e.target === wheelEl.value && e.propertyName === "transform") settle();
}

// Rotating the wheel by -theta puts wheel-angle theta under the fixed pointer
// at the top; the win arc starts at the top, so a roll below the chance lands
// inside it. Always turns forward SPIN_TURNS full turns plus whatever aligns it.
function animateTo(rollPpm: number): void {
  const theta = (rollPpm / UPGRADER_PPM) * 360;
  const align = (((-theta - rotation.value) % 360) + 360) % 360;
  phase.value = "spinning";
  rotation.value = rotation.value + SPIN_TURNS * 360 + align;
  if (prefersReducedMotion()) {
    // No travel to wait for: show where it landed and the result straight away.
    queueMicrotask(settle);
  } else {
    settleTimer = setTimeout(settle, SPIN_MS + 300);
  }
}

async function onSpin(e: Event): Promise<void> {
  if (!canSpin.value || hundredths.value === null || quote.value === null) return;
  const bet = {
    stake: stake.value,
    gain: quote.value.payout - stake.value,
    frenzyMs: consolationMs(stake.value, owned.value)
  };
  // Forget the previous bet: if this spin is refused, the wheel and tiles must
  // fall back to what the controls say NOW, not keep showing the last spin's odds.
  outcome.value = null;
  placed.value = null;
  phase.value = "requesting";
  // The controls are about to lock; move focus onto the (still focusable) Spin
  // button first, so keyboard focus can't fall out of the dialog onto the page.
  spinBtn.value?.focus();
  const result = await upgrader.spin(bet.stake, multiplier.value, e);
  if (!result) {
    phase.value = "idle";
    return;
  }
  if (!ui.upgraderOpen) {
    // Closed while the server was answering: the result is already applied, so
    // there is nothing to animate — just let the PhD readouts catch up.
    upgrader.releaseReveal();
    phase.value = "idle";
    return;
  }
  placed.value = bet;
  outcome.value = result;
  animateTo(result.rollPpm);
}

function reset(): void {
  clearTimer();
  phase.value = "idle";
  outcome.value = null;
  placed.value = null;
  // Not animating while idle, so this is an instant snap: a fresh wheel always
  // starts with its win arc at 12 o'clock and the pointer on the arc's leading edge.
  rotation.value = 0;
  stakeText.value = defaultStake();
}

function close(): void {
  ui.upgraderOpen = false;
}

watch(
  () => ui.upgraderOpen,
  (open) => {
    if (open) {
      reset();
    } else {
      clearTimer();
      upgrader.releaseReveal();
      phase.value = "idle";
    }
  }
);

// Choosing a different bet after a result starts a fresh one.
watch([stakeText, multiplier], () => {
  if (phase.value === "settled") {
    phase.value = "idle";
    outcome.value = null;
    placed.value = null;
    // The arc is redrawn for the new bet; left at the old angle the fixed pointer
    // could sit on an arc boundary and read as a prediction.
    rotation.value = 0;
  }
});

onBeforeUnmount(() => {
  clearTimer();
  upgrader.releaseReveal();
});
</script>

<template>
  <BaseModal
    :open="ui.upgraderOpen"
    :title="t('upgrader.title')"
    :max-width="460"
    :z-index="1000"
    :compact="isPhone"
    @close="close"
  >
    <div class="upgrader">
      <div class="wheel-stage" role="img" :aria-label="wheelAria">
        <svg
          ref="wheelEl"
          class="wheel"
          :class="{ animating: phase === 'spinning' }"
          :style="{ transform: `rotate(${rotation}deg)` }"
          viewBox="0 0 100 100"
          aria-hidden="true"
          @transitionend="onTransitionEnd"
        >
          <circle class="wheel-lose" cx="50" cy="50" r="40" fill="none" />
          <circle
            v-if="winDash > 0"
            class="wheel-win"
            cx="50"
            cy="50"
            r="40"
            fill="none"
            pathLength="100"
            :stroke-dasharray="`${winDash} ${100 - winDash}`"
            transform="rotate(-90 50 50)"
          />
          <circle class="wheel-rim" cx="50" cy="50" r="47.5" fill="none" />
          <circle class="wheel-rim" cx="50" cy="50" r="32.5" fill="none" />
        </svg>
        <svg class="pointer" viewBox="0 0 20 16" aria-hidden="true">
          <path d="M2 1 H18 L10 14 Z" />
        </svg>
        <div class="hub">
          <span class="hub-pct">{{ winPct === null ? "—" : `${winPct}%` }}</span>
          <span class="hub-sub">{{ t("upgrader.chanceCentre") }}</span>
        </div>
      </div>

      <div class="outcomes">
        <div
          class="outcome win"
          :class="{ hit: resultLine?.won === true, miss: resultLine?.won === false }"
        >
          <span class="outcome-head">
            <span class="swatch" aria-hidden="true" />
            <span class="outcome-label">{{ t("upgrader.win") }}</span>
            <span v-if="winPct !== null" class="outcome-chance">{{ winPct }}%</span>
          </span>
          <span class="outcome-main">{{ shown ? `+${fmt(shown.gain)} PhD` : "—" }}</span>
        </div>
        <div
          class="outcome lose"
          :class="{ hit: resultLine?.won === false, miss: resultLine?.won === true }"
        >
          <span class="outcome-head">
            <span class="swatch" aria-hidden="true" />
            <span class="outcome-label">{{ t("upgrader.lose") }}</span>
            <span v-if="losePct !== null" class="outcome-chance">{{ losePct }}%</span>
          </span>
          <span class="outcome-main">{{ shown ? `−${fmt(shown.stake)} PhD` : "—" }}</span>
          <span v-if="shown" class="outcome-sub">
            {{
              shown.frenzyMs > 0
                ? t("upgrader.frenzyOnLoss", {
                    name: frenzyName,
                    seconds: Math.ceil(shown.frenzyMs / 1000)
                  })
                : t("upgrader.noFrenzyOnLoss", { name: frenzyName })
            }}
          </span>
        </div>
      </div>

      <div class="field">
        <div class="field-head">
          <label class="field-label" for="upgrader-stake">{{ t("upgrader.stake") }}</label>
          <span class="field-value">
            {{ t("upgrader.owned", { phd: fmt(game.phdCountDisplay) }) }}
          </span>
        </div>
        <div class="stake-row">
          <input
            id="upgrader-stake"
            class="stake-input"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :value="stakeText"
            :disabled="busy"
            @input="onStakeInput"
            @keydown.enter.prevent="onSpin($event)"
          />
          <div class="seg-group" role="group" :aria-label="t('upgrader.stake')">
            <button
              v-for="p in STAKE_PERCENTS"
              :key="p"
              type="button"
              class="seg-btn"
              :disabled="busy || owned < 1"
              :aria-label="
                p === 100
                  ? t('upgrader.stakeAllAria')
                  : t('upgrader.stakeChipAria', { pct: p })
              "
              @click="setStakePercent(p)"
            >
              {{ p === 100 ? t("upgrader.stakeMax") : `${p}%` }}
            </button>
          </div>
        </div>
      </div>

      <div class="field">
        <div class="field-head">
          <span class="field-label">{{ t("upgrader.multiplier") }}</span>
          <span class="field-value mult-value">×{{ formatMult(multiplier) }}</span>
        </div>
        <div class="seg-group" role="group" :aria-label="t('upgrader.multiplier')">
          <button
            v-for="m in UPGRADER_PRESET_MULTIPLIERS"
            :key="m"
            type="button"
            class="seg-btn"
            :class="{ active: multiplier === m }"
            :aria-pressed="multiplier === m"
            :disabled="busy"
            @click="multiplier = m"
          >
            ×{{ m }}
          </button>
        </div>
        <input
          class="slider"
          type="range"
          min="0"
          max="1000"
          :step="SLIDER_STEP"
          :value="sliderPosition"
          :disabled="busy"
          :aria-label="t('upgrader.multiplierSlider')"
          :aria-valuetext="`×${formatMult(multiplier)}`"
          @input="onSlider"
        />
        <div class="slider-ends" aria-hidden="true">
          <span>×1.2</span>
          <span>×100</span>
        </div>
      </div>

      <div class="actions">
        <!-- One line for whatever needs saying right now: the result of the spin
             that just landed, or why the current bet can't be spun. Directly
             above the button it concerns, and a fixed height so it appearing
             never moves the button. -->
        <div id="upgrader-status" class="status">
          <!-- Only the result and the problem are announced; the standing fine
               print below is not re-read every time it reappears. -->
          <div class="status-live" aria-live="polite">
            <template v-if="resultLine">
              <p class="status-main" :class="resultLine.won ? 'won' : 'lost'">
                {{ resultLine.main }}
              </p>
              <p v-if="statusSub" class="status-sub">{{ statusSub }}</p>
            </template>
            <p v-else-if="phase === 'idle' && problem" class="status-problem">{{ problem }}</p>
          </div>
          <p v-if="showFinePrint" class="status-fine">
            {{
              t("upgrader.finePrint", {
                rtp: Math.round(UPGRADER_RTP * 100),
                cap: Math.round(UPGRADER_WIN_CHANCE_CAP * 100)
              })
            }}
          </p>
        </div>
        <!-- aria-disabled rather than disabled: a disabled button drops keyboard
             focus, and the next Tab would leave the dialog. onSpin ignores the
             click while the bet can't be spun. -->
        <button
          ref="spinBtn"
          class="spin-btn"
          type="button"
          :aria-disabled="!canSpin"
          aria-describedby="upgrader-status"
          @click="onSpin($event)"
        >
          {{ spinLabel }}
        </button>
      </div>

      <!-- Last in the DOM on purpose: BaseModal focuses the first focusable element
           on open, and that should be the stake field, not this. It is positioned
           absolutely, so it still sits at the top right. -->
      <button class="modal-close" type="button" :aria-label="t('upgrader.close')" @click="close">
        ✕
      </button>

      <div class="notes">
        <p v-if="!auth.isLoggedIn" class="note">{{ t("upgrader.guestNote") }}</p>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.upgrader {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── Wheel ───────────────────────────────────────────────── */
.wheel-stage {
  --wheel: 224px;
  position: relative;
  width: var(--wheel);
  height: var(--wheel);
  margin: 4px auto 0;
}

.wheel {
  display: block;
  width: 100%;
  height: 100%;
  will-change: transform;
}

/* Exponential ease-out: a fast start that decelerates onto the roll. */
.wheel.animating {
  transition: transform 3200ms cubic-bezier(0.16, 1, 0.3, 1);
}

.wheel-lose {
  stroke: var(--bg-hover);
  stroke-width: 14;
}

.wheel-win {
  stroke: var(--booster);
  stroke-width: 14;
  transition: stroke-dasharray 200ms ease;
}
.wheel.animating .wheel-win {
  transition: none;
}

.wheel-rim {
  stroke: var(--border);
  stroke-width: 1;
}

.pointer {
  position: absolute;
  top: -7px;
  left: 50%;
  width: 22px;
  height: 18px;
  transform: translateX(-50%);
  fill: var(--text-primary);
  stroke: var(--bg-surface);
  stroke-width: 1.5;
  stroke-linejoin: round;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.35));
}

.hub {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}

.hub-pct {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -1px;
  line-height: 1;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.hub-sub {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-secondary);
}

/* ── Outcomes (also the wheel's legend) ──────────────────── */
.outcomes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.outcome {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  box-shadow: inset 0 0 0 1px transparent;
  transition: box-shadow var(--transition-base);
}

.outcome.hit.win {
  box-shadow: inset 0 0 0 1px var(--booster);
}
.outcome.hit.lose {
  box-shadow: inset 0 0 0 1px var(--danger);
}
/* The outcome that didn't happen steps back, but stays readable: a win that was
   missed is still worth re-reading. Only the swatch and the amount recede. */
.outcome.miss .swatch {
  opacity: 0.4;
}
.outcome.miss .outcome-main {
  color: var(--text-secondary);
}

.outcome-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--text-secondary);
}

.swatch {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}
.win .swatch {
  background: var(--booster);
}
.lose .swatch {
  background: var(--bg-hover);
  box-shadow: inset 0 0 0 1px var(--text-muted);
}

.outcome-chance {
  margin-left: auto;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}

.outcome-main {
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.3px;
}

.outcome-sub {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.35;
}

/* ── Controls ────────────────────────────────────────────── */
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.field-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--text-secondary);
}

.field-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.mult-value {
  font-size: 15px;
  font-weight: 800;
  color: var(--accent-text);
}

.stake-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.stake-input {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  transition: border-color var(--transition-fast);
}
.stake-input:hover:not(:disabled),
.stake-input:focus {
  border-color: var(--accent);
}
.stake-input:disabled {
  opacity: 0.6;
}

/* The segmented-control look shared with the leaderboard and the shop. */
.seg-group {
  display: flex;
  gap: 4px;
}

.seg-btn {
  flex: 1;
  padding: 6px 8px;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  transition: all var(--transition-fast);
}
.seg-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-text);
  background: var(--bg-hover);
}
.seg-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.seg-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* Native range, restyled to the same tokens. The input box (32px, 40px on a
   phone) is the touch target; the 6px track and 20px thumb are what's drawn. */
.slider {
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 32px;
  background: transparent;
  cursor: pointer;
}
.slider:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.slider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}
.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  margin-top: -8px;
  border-radius: var(--radius-full);
  background: var(--accent);
  border: 2px solid var(--bg-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}
.slider::-moz-range-track {
  height: 6px;
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}
.slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--accent);
  border: 2px solid var(--bg-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.slider-ends {
  display: flex;
  justify-content: space-between;
  margin-top: -4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ── Actions ─────────────────────────────────────────────── */
/* Always in view: when the modal is taller than the screen, the status line and
   Spin stay put while the rest scrolls, so tapping Spin never scrolls the wheel
   away (a browser scrolls a tapped control into view; this one already is). */
.actions {
  position: sticky;
  bottom: -1px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 8px;
  background: var(--bg-surface);
}

/* When the controls scroll under the bar, a soft fade says there is more above. */
.actions::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: -26px;
  height: 26px;
  background: linear-gradient(to top, var(--bg-surface), transparent);
  pointer-events: none;
}

/* The result of a spin, or why the bet can't be spun. */
.status {
  /* Tall enough for the three-line fine print on a phone, so swapping it for a
     result (or back) never moves the Spin button. */
  min-height: 46px;
  text-align: center;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.status-live > *,
.status-fine {
  animation: fadeScaleIn 200ms ease both;
}

.status-main {
  font-size: 15px;
  font-weight: 800;
}
.status-main.won {
  color: var(--success);
}
.status-main.lost {
  color: var(--danger);
}

.status-sub {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-secondary);
}

.status-problem {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
}

/* The honesty line (long-run return, win-chance cap): real information, so the
   readable secondary colour, not the faint muted one. */
.status-fine {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
}

.spin-btn {
  width: 100%;
  min-height: 44px;
  padding: 12px 16px;
  border-radius: var(--radius-sm);
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
  font-size: 14px;
  font-weight: 800;
  transition: filter var(--transition-fast);
}
.spin-btn:hover:not([aria-disabled="true"]) {
  filter: brightness(1.1);
}
.spin-btn[aria-disabled="true"] {
  background: var(--btn-dis-bg);
  color: var(--btn-dis-text);
  cursor: not-allowed;
}

.notes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.note {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  text-align: center;
}

/* Positioned against the modal box itself (.upgrader is not positioned), like
   AuthModal's close button. */
.modal-close {
  position: absolute;
  top: 12px;
  right: 14px;
  min-width: 32px;
  min-height: 32px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  border-radius: var(--radius-xs);
  transition: color var(--transition-fast);
}
.modal-close:hover {
  color: var(--text-primary);
}

/* A shorter screen gives the wheel less of it, so the controls and Spin stay in
   reach without scrolling. */
@media (max-height: 820px) {
  .wheel-stage {
    --wheel: clamp(128px, 22dvh, 224px);
  }
}

@media (max-width: 759px) {
  /* Touch-driven at this width — the compact desktop sizing is too small a target. */
  .seg-btn {
    min-height: 44px;
  }
  .stake-input {
    min-height: 44px;
  }
  .slider {
    height: 40px;
  }
}

@media (max-width: 480px) {
  .upgrader {
    gap: 10px;
  }
  /* Input and quick-picks stay on one row: four 44px chips leave the input room. */
  .stake-row .seg-btn {
    flex: 0 0 auto;
    min-width: 44px;
    padding-inline: 6px;
  }
  .outcome {
    padding: 8px 10px;
  }
  .outcome-main {
    font-size: 15px;
  }
  .modal-close {
    top: 4px;
    right: 4px;
    min-width: 44px;
    min-height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .wheel.animating {
    transition: none;
  }
  .wheel-win,
  .outcome {
    transition: none;
  }
}
</style>
