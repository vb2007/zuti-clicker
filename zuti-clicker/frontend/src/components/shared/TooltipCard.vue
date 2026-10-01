<script setup lang="ts">
import type { AnchoredTooltipStyle } from "@/composables/useAnchoredTooltip";

// Shared shell for UnitCard's and UpgradeTile's info tooltip — the
// Teleport/fade/positioning/name+description chrome, extracted so a future
// visual tweak (shadow, spacing, a new header row) only needs to change in
// one place. The row content below the divider stays local to each caller
// (a `.tip-row`/`.tip-val` pair, still small enough that extracting it too
// isn't worth the indirection — same call the codebase already makes for
// MultiplierSelector's segmented-control pattern).
// `width` must match whatever the caller passed to useAnchoredTooltip(width) —
// the positioning calc there centers against that same number. When the
// viewport is narrower than that, the composable's clamped width (carried in
// `positionStyle.width`) wins over this prop.
const props = withDefaults(
  defineProps<{
    tooltipId: string;
    visible: boolean;
    positionStyle: AnchoredTooltipStyle | null;
    title: string;
    description: string;
    width?: number;
  }>(),
  { width: 220 }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="tip">
      <div
        v-if="visible"
        :id="tooltipId"
        class="tooltip"
        role="tooltip"
        :style="{ width: `${props.width}px`, ...(positionStyle ?? {}) }"
      >
        <div class="tip-name">{{ title }}</div>
        <div class="tip-desc">{{ description }}</div>
        <div class="tip-divider"></div>
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* position:fixed, top/left set inline from the anchor's own
   getBoundingClientRect() (see useAnchoredTooltip.ts), clamped to the
   viewport. Teleported to <body> so it isn't clipped by the shop panel's
   `overflow-y: auto`, nor (at mobile widths) repositioned by the mobile
   sheet's own `transform`, which would otherwise become this element's
   containing block instead of the viewport. */
.tooltip {
  /* width set inline (see the template) so it always matches the `width`
     prop useAnchoredTooltip's positioning calc used. */
  position: fixed;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
  z-index: 600;
  pointer-events: none;
}

.tip-name {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-text);
  margin-bottom: 4px;
}

.tip-desc {
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 10px;
}

.tip-divider {
  height: 1px;
  background: var(--border-subtle);
  margin-bottom: 8px;
}

.tip-enter-active,
.tip-leave-active {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
