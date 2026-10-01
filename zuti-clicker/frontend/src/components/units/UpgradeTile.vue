<script setup lang="ts">
import { computed, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { UPGRADE_DEFINITIONS } from "@/utils/gameConstants";
import { formatNumber } from "@/utils/formatters";
import { getUpgradeEffectLabel } from "@/utils/upgrades";
import { useAnchoredTooltip } from "@/composables/useAnchoredTooltip";
import TooltipCard from "@/components/shared/TooltipCard.vue";

const props = defineProps<{ upgradeId: string }>();

const { t } = useI18n();
const game = useGameStore();
const antiCheat = useAntiCheatStore();

const def = computed(() => UPGRADE_DEFINITIONS.find((d) => d.id === props.upgradeId)!);
const affordable = computed(() => game.canAffordUpgrade(props.upgradeId));

const nameKey = computed(() => `upgrades.names.${props.upgradeId}` as Parameters<typeof t>[0]);
const descKey = computed(() => `upgrades.descriptions.${props.upgradeId}` as Parameters<typeof t>[0]);

// A compact label for the tile face — the tooltip (below) spells out the
// full effect in words. Shared with the owned-upgrades summary
// (UpgradesPanel.vue) via utils/upgrades.ts so the two can't drift apart.
const effectLabel = computed(() => (def.value ? getUpgradeEffectLabel(def.value) : ""));

// Whole-tile hover/focus opens the tooltip (unlike UnitCard's dedicated
// info-button icon) — there's no room for a second interactive element in a
// compact square tile, and the tile itself isn't draggable/scrollable
// content that hover would otherwise conflict with.
const {
  anchorRef,
  visible: tooltipVisible,
  tooltipId,
  style: tooltipStyle,
  onEnter,
  onLeave,
  onFocus,
  onBlur,
  open: openTooltip,
  close: closeTooltip
} = useAnchoredTooltip(200);

// Touch has no hover, and a tap buys — so a touch user could never read what an
// upgrade does before paying for it. Holding a tile previews it instead.
//
// The threshold is what keeps this out of the way of buying in bulk: a tap that
// lifts before LONG_PRESS_MS (rapid-fire tapping is ~100-200ms a tap) never arms
// anything, the timer is cancelled by lift/cancel/movement, and only a press that
// actually fired the preview swallows the click that follows its release.
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_PX = 10;
const SWALLOW_WINDOW_MS = 400;
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let swallowTimer: ReturnType<typeof setTimeout> | null = null;
let pressOrigin: { x: number; y: number } | null = null;
let longPressFired = false;
let swallowClick = false;

function clearPress(): void {
  if (pressTimer !== null) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  pressOrigin = null;
}

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType !== "touch") return;
  clearPress();
  longPressFired = false;
  swallowClick = false;
  pressOrigin = { x: e.clientX, y: e.clientY };
  pressTimer = setTimeout(() => {
    pressTimer = null;
    longPressFired = true;
    openTooltip();
  }, LONG_PRESS_MS);
}

function onPointerMove(e: PointerEvent): void {
  if (!pressOrigin) return;
  if (Math.hypot(e.clientX - pressOrigin.x, e.clientY - pressOrigin.y) > LONG_PRESS_MOVE_PX) {
    clearPress();
  }
}

function onPointerUp(): void {
  clearPress();
  if (!longPressFired) return;
  // The browser fires a click right after this pointerup — it ends a preview, it
  // must not also buy. Expires on its own in case no click ever follows.
  longPressFired = false;
  swallowClick = true;
  if (swallowTimer !== null) clearTimeout(swallowTimer);
  swallowTimer = setTimeout(() => {
    swallowClick = false;
    swallowTimer = null;
  }, SWALLOW_WINDOW_MS);
}

function onPointerCancel(): void {
  clearPress();
  longPressFired = false;
}

// A touch long-press can raise the OS context menu / text-selection callout.
function onContextMenu(e: MouseEvent): void {
  if ((e as PointerEvent).pointerType === "touch") e.preventDefault();
}

onUnmounted(() => {
  clearPress();
  if (swallowTimer !== null) clearTimeout(swallowTimer);
});

// isTrusted-gated the same way UnitCard.vue's buy() is — see that
// component's comment for why this matters even though the purchase itself
// is already economically bounded.
function buy(e: MouseEvent) {
  if (!e.isTrusted) {
    antiCheat.recordClick(false);
    return;
  }
  if (swallowClick) {
    swallowClick = false;
    return;
  }
  // aria-disabled (not disabled) keeps the tile focusable and hoverable, so a
  // locked upgrade's tooltip can still be read — it just never buys.
  if (!affordable.value || antiCheat.isRestricted) return;
  if (game.buyUpgrade(props.upgradeId)) {
    antiCheat.recordPurchase();
    // A preview left open by a long-press has done its job.
    closeTooltip();
  }
}
</script>

<template>
  <button
    ref="anchorRef"
    type="button"
    class="upgrade-tile"
    :class="{ affordable }"
    :aria-disabled="!affordable || antiCheat.isRestricted"
    :aria-describedby="tooltipVisible ? tooltipId : undefined"
    @click="buy($event)"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @contextmenu="onContextMenu"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focus="onFocus"
    @blur="onBlur"
  >
    <span class="tile-name">{{ t(nameKey) }}</span>
    <span class="tile-effect">{{ effectLabel }}</span>
    <span class="tile-cost">{{ formatNumber(def.cost) }}</span>
  </button>

  <TooltipCard
    :tooltip-id="tooltipId"
    :visible="tooltipVisible"
    :position-style="tooltipStyle"
    :width="200"
    :title="t(nameKey)"
    :description="t(descKey)"
  >
    <div class="tip-row">
      <span>{{ t("upgrades.tooltipCost") }}</span>
      <span class="tip-val">{{ formatNumber(def.cost) }}</span>
    </div>
    <div class="tip-row">
      <span>{{ t("upgrades.tooltipEffect") }}</span>
      <span class="tip-val accent">{{ effectLabel }}</span>
    </div>
  </TooltipCard>
</template>

<style scoped>
.upgrade-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  aspect-ratio: 1;
  padding: 8px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
  text-align: center;
  /* Holding a tile previews it (see the long-press handling in the script):
     keep iOS from raising its callout / starting a text selection meanwhile. */
  -webkit-touch-callout: none;
  user-select: none;
  touch-action: manipulation;
}

.upgrade-tile.affordable {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow);
}

@media (hover: hover) {
  .upgrade-tile.affordable:hover {
    background: var(--bg-hover);
    box-shadow: 0 4px 14px var(--accent-glow);
  }
}

.upgrade-tile[aria-disabled="true"] {
  cursor: not-allowed;
  opacity: 0.55;
}

.tile-name {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
  max-width: 100%;
  /* Break/hyphenate a long word (<html lang> is kept in sync with the language
     setting, so hyphens: auto uses the right dictionary) rather than let it
     push the tile wider than its column. */
  overflow-wrap: break-word;
  hyphens: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.tile-effect {
  font-size: 10px;
  font-weight: 700;
  color: var(--accent-text);
}

.tile-cost {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.upgrade-tile[aria-disabled="true"] .tile-cost {
  color: var(--btn-dis-text);
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
</style>
