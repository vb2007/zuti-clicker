import { useMediaQuery } from "@/composables/useMediaQuery";

// Below this, the fixed three-column shell (status rail | clicker | shop
// rail) no longer fits: the clicker collapses to near-nothing between two
// fixed-width sidebars. Matches the `@media (max-width: 759px)` breakpoint in
// App.vue/AppHeader.vue/ToastHost.vue — keep those in sync with this value.
export const COMPACT_BREAKPOINT_PX = 760;

/**
 * Reactive `isCompact` (viewport narrower than COMPACT_BREAKPOINT_PX), a thin
 * wrapper over useMediaQuery.
 */
export function useBreakpoint(maxWidthPx: number = COMPACT_BREAKPOINT_PX) {
  const { matches } = useMediaQuery(`(max-width: ${maxWidthPx - 1}px)`);
  return { isCompact: matches };
}
