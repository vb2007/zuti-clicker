// Where a booster pickup may appear on the clicker area.
//
// Pure geometry (pixels in, percentages out) so it can be tested across the
// whole range of clicker-area sizes — a percentage-only zone is a different
// physical shape on every viewport, which is how pickups used to land on the
// click circle on phones.

export interface PlacementLayout {
  /** The clicker area's own size. */
  areaW: number;
  areaH: number;
  /** The click circle, in the area's own coordinate space. */
  circle: { cx: number; cy: number; r: number };
}

// keep in sync with BoosterPickup.vue (.booster-pickup is 52px wide)
export const PICKUP_RADIUS_PX = 26;
// Never closer than this to an edge of the area (overflow: hidden would clip it).
const EDGE_MARGIN_PX = 6;
// Breathing room between the pickup and the circle's edge.
const CIRCLE_CLEARANCE_PX = 8;
const MAX_ATTEMPTS = 40;

/** Used when the area can't be measured (no DOM): a typical desktop clicker area. */
export const DEFAULT_LAYOUT: PlacementLayout = {
  areaW: 600,
  areaH: 500,
  circle: { cx: 300, cy: 215, r: 110 }
};

/**
 * Picks a random position for a pickup that is fully inside the area and
 * clear of the circle, as percentages of the area (what BoosterPickup.vue
 * positions by). Falls back to whichever corner is farthest from the circle
 * when random sampling finds nothing — and always stays inside the area, even
 * when the area is smaller than a pickup.
 */
export function randomSafePosition(
  layout: PlacementLayout,
  random: () => number = Math.random
): { xPct: number; yPct: number } {
  const { areaW, areaH, circle } = layout;
  const inset = EDGE_MARGIN_PX + PICKUP_RADIUS_PX;
  const minX = Math.min(inset, areaW / 2);
  const maxX = Math.max(areaW - inset, areaW / 2);
  const minY = Math.min(inset, areaH / 2);
  const maxY = Math.max(areaH - inset, areaH / 2);
  const clearance = circle.r + PICKUP_RADIUS_PX + CIRCLE_CLEARANCE_PX;

  const toPct = (x: number, y: number) => ({
    xPct: (x / areaW) * 100,
    yPct: (y / areaH) * 100
  });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const x = minX + random() * (maxX - minX);
    const y = minY + random() * (maxY - minY);
    if (Math.hypot(x - circle.cx, y - circle.cy) >= clearance) return toPct(x, y);
  }

  // No room found by sampling (a very small area): take the corner farthest from the circle.
  const corners: [number, number][] = [
    [minX, minY],
    [maxX, minY],
    [minX, maxY],
    [maxX, maxY]
  ];
  const [x, y] = corners.reduce((best, c) =>
    Math.hypot(c[0] - circle.cx, c[1] - circle.cy) >
    Math.hypot(best[0] - circle.cx, best[1] - circle.cy)
      ? c
      : best
  );
  return toPct(x, y);
}
