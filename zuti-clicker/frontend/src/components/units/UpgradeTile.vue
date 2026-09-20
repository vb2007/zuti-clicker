<script setup lang="ts">
import { computed } from "vue";
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
  onBlur
} = useAnchoredTooltip(200);

// isTrusted-gated the same way UnitCard.vue's buy() is — see that
// component's comment for why this matters even though the purchase itself
// is already economically bounded.
function buy(e: MouseEvent) {
  if (!e.isTrusted) {
    antiCheat.recordClick(false);
    return;
  }
  if (!affordable.value) return;
  if (game.buyUpgrade(props.upgradeId)) antiCheat.recordPurchase();
}
</script>

<template>
  <button
    ref="anchorRef"
    type="button"
    class="upgrade-tile"
    :class="{ affordable }"
    :disabled="!affordable || antiCheat.isRestricted"
    :aria-describedby="tooltipVisible ? tooltipId : undefined"
    @click="buy($event)"
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
}

.upgrade-tile.affordable {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-glow);
}

.upgrade-tile.affordable:hover {
  background: var(--bg-hover);
  box-shadow: 0 4px 14px var(--accent-glow);
}

.upgrade-tile:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.tile-name {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
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

.upgrade-tile:disabled .tile-cost {
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
