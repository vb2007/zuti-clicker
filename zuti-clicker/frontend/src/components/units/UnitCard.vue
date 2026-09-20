<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { UNIT_DEFINITIONS } from "@/utils/gameConstants";
import { getMaxBuyable } from "@/utils/costCalculator";
import { formatNumber, formatRate } from "@/utils/formatters";
import { useAnchoredTooltip } from "@/composables/useAnchoredTooltip";
import TooltipCard from "@/components/shared/TooltipCard.vue";
import type { Multiplier } from "@/types";

const props = defineProps<{ unitId: string; multiplier: Multiplier }>();

const { t } = useI18n();
const game = useGameStore();

const def = computed(() => UNIT_DEFINITIONS.find((d) => d.id === props.unitId)!);
const state = computed(() => game.unitStates.find((u) => u.id === props.unitId)!);
const owned = computed(() => state.value?.owned ?? 0);

const effectiveAmount = computed(() => {
  if (!def.value) return 0;
  if (props.multiplier === "max") {
    return getMaxBuyable(def.value, owned.value, game.tokens, game.effectiveCostMultiplier);
  }
  return props.multiplier;
});

const cost = computed(() => game.getBuyCost(props.unitId, props.multiplier));
// The clearance booster's discount is otherwise invisible anywhere near the
// price it's actually discounting — tint the cost the shared booster accent
// while it's active, matching the affected StatusColumn stats' treatment.
const discounted = computed(() => game.boosterCostReductionActive);
const affordable = computed(() => game.canAfford(props.unitId, props.multiplier));
const gainPerS = computed(() => game.getProductionGain(props.unitId, props.multiplier));

const visible = computed(() => game.isUnitRevealed(props.unitId));

const nameKey = computed(() => `units.names.${props.unitId}` as Parameters<typeof t>[0]);
const descKey = computed(() => `units.descriptions.${props.unitId}` as Parameters<typeof t>[0]);

function buy() {
  if (!affordable.value || effectiveAmount.value === 0) return;
  game.buyUnit(props.unitId, props.multiplier);
}

const btnLabel = computed(() => {
  if (props.multiplier === "max") {
    return effectiveAmount.value > 0 ? `×${effectiveAmount.value}` : "—";
  }
  return `×${props.multiplier}`;
});

// Tooltip: visible on hovering or focusing the dedicated info button —
// scoped to that button specifically, not the whole card, since the icon is
// what visually signals "hover/tap here for more" and having the entire row
// react to hover regardless was confusing (the icon looked decorative if
// hovering anywhere else already opened it). Keyboard Tab focuses the
// button directly; a touch tap also focuses it (that's how touch reveals
// it), and tapping elsewhere blurs it closed, a natural dismiss with no
// extra affordance needed. See useAnchoredTooltip for the positioning logic
// (shared with UpgradeTile.vue).
const {
  anchorRef: infoBtnRef,
  visible: tooltipVisible,
  tooltipId,
  style: tooltipStyle,
  onEnter: onInfoEnter,
  onLeave: onInfoLeave,
  onFocus: onInfoFocus,
  onBlur: onInfoBlur
} = useAnchoredTooltip();
</script>

<template>
  <Transition name="unit-appear">
    <div v-if="visible" class="unit-card" :class="{ affordable }">
      <!-- left: info -->
      <div class="unit-info">
        <div class="unit-name-row">
          <span class="unit-name">{{ t(nameKey) }}</span>
          <button
            ref="infoBtnRef"
            type="button"
            class="info-btn"
            :aria-label="t('units.moreInfo')"
            :aria-describedby="tooltipVisible ? tooltipId : undefined"
            @mouseenter="onInfoEnter"
            @mouseleave="onInfoLeave"
            @focus="onInfoFocus"
            @blur="onInfoBlur"
          >
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4" />
              <circle cx="8" cy="4.7" r="1" fill="currentColor" />
              <line
                x1="8"
                y1="7.2"
                x2="8"
                y2="11.6"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
        <div class="unit-sub">
          <span class="owned-count">{{ owned }}</span>
          <span class="owned-label"> {{ t("units.owned") }}</span>
          <span class="prod-badge">{{ formatRate(def?.baseProduction ?? 0) }}/s</span>
        </div>
      </div>

      <!-- right: buy button -->
      <button class="buy-btn" :disabled="!affordable || effectiveAmount === 0" @click.stop="buy">
        <span class="btn-mult">{{ btnLabel }}</span>
        <span class="btn-cost" :class="{ discounted }">{{ formatNumber(cost) }}</span>
      </button>
    </div>
  </Transition>

  <TooltipCard
    :tooltip-id="tooltipId"
    :visible="tooltipVisible"
    :position-style="tooltipStyle"
    :title="t(nameKey)"
    :description="t(descKey)"
  >
    <div class="tip-row">
      <span>{{ t("units.tooltipCost") }}</span>
      <span class="tip-val">{{ formatNumber(cost) }}</span>
    </div>
    <div v-if="effectiveAmount > 0" class="tip-row">
      <span>{{ t("units.tooltipGain") }}</span>
      <span class="tip-val accent">+{{ formatRate(gainPerS) }}/s</span>
    </div>
    <div class="tip-row">
      <span>{{ t("units.tooltipEach") }}</span>
      <span class="tip-val">{{ formatRate(def?.baseProduction ?? 0) }}/s</span>
    </div>
  </TooltipCard>
</template>

<style scoped>
.unit-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--transition-fast);
}

.unit-card:hover {
  background: var(--bg-elevated);
}

.unit-card.affordable {
  border-left: 2px solid var(--accent);
}

.unit-card.affordable:hover {
  background: var(--bg-hover);
}

/* info */
.unit-info {
  flex: 1;
  min-width: 0;
}

.unit-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.unit-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.info-btn {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  transition: color var(--transition-fast);
  position: relative;
}
.info-btn:hover,
.info-btn:focus-visible {
  color: var(--accent-text);
}

/* The 20px icon is a precise, small hover target on purpose — hovering
   near-but-not-on it must not open the tooltip. An earlier version padded
   the hit target out to 44px unconditionally (a transparent ::before) for
   touch reachability, but that same padding is exactly what let a mouse
   trigger it from noticeably off the visible icon. Touch has no such
   precision concern (a tap is a single contact point, not "near" anything
   the way a mouse can hover past), so the padding now only applies on
   devices that can't hover at all. */
@media (hover: none) and (pointer: coarse) {
  .info-btn::before {
    content: "";
    position: absolute;
    inset: -12px;
  }
}

.unit-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
}

.owned-count {
  font-size: 12px;
  font-weight: 800;
  color: var(--accent-text);
  font-variant-numeric: tabular-nums;
}

.owned-label {
  font-size: 11px;
  color: var(--text-muted);
}

.prod-badge {
  margin-left: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-full);
  padding: 1px 6px;
}

/* buy button */
.buy-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 68px;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  background: var(--btn-buy-bg);
  color: var(--btn-buy-text);
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.buy-btn:hover:not(:disabled) {
  filter: brightness(1.15);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px var(--accent-glow);
}

.buy-btn:active:not(:disabled) {
  transform: translateY(0);
}

.buy-btn:disabled {
  background: var(--btn-dis-bg);
  cursor: not-allowed;
}

.btn-mult {
  font-size: 10px;
  font-weight: 700;
  opacity: 0.75;
  line-height: 1.2;
}

.buy-btn:disabled .btn-mult,
.buy-btn:disabled .btn-cost {
  color: var(--btn-dis-text);
}

.btn-cost {
  font-size: 13px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

/* clearance booster active — see the `discounted` computed. Specificity
   below .buy-btn:disabled .btn-cost, so an unaffordable price still grays
   out normally rather than looking simultaneously discounted and disabled. */
.btn-cost.discounted {
  color: var(--booster);
}

@media (max-width: 759px) {
  /* This panel becomes a touch-driven mobile sheet at this width (see
     App.vue) — the buy button's desktop sizing runs a little short of a
     comfortable touch target. */
  .buy-btn {
    min-height: 44px;
  }
}

/* tip-row/tip-val: the tooltip shell (.tooltip/.tip-name/.tip-desc/
   .tip-divider/transitions) lives in the shared TooltipCard.vue now — this
   is only the content this component supplies via its default slot. */
.tip-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}

.tip-val {
  font-weight: 700;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.tip-val.accent {
  color: var(--accent-text);
}

.unit-appear-enter-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}
.unit-appear-enter-from {
  opacity: 0;
  transform: translateX(12px);
}
</style>
