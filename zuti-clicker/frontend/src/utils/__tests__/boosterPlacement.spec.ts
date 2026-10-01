import { describe, it, expect } from "vitest";
import {
  randomSafePosition,
  DEFAULT_LAYOUT,
  PICKUP_RADIUS_PX,
  type PlacementLayout
} from "@/utils/boosterPlacement";

// The circle is centred horizontally; its vertical centre depends on the column
// below it (hint + cps pill), so it sits a little above the area's centre.
function layoutFor(areaW: number, areaH: number, circleD: number): PlacementLayout {
  return { areaW, areaH, circle: { cx: areaW / 2, cy: areaH / 2 - 40, r: circleD / 2 } };
}

// Sizes seen in practice: 320px phone portrait (668 - header/tab bar), 375x520,
// phone landscape (667x230), a tablet column, desktop and a big monitor.
const MATRIX: [string, PlacementLayout][] = [
  ["320x424 phone portrait", layoutFor(320, 424, 220)],
  ["375x520 phone portrait", layoutFor(375, 520, 220)],
  ["390x700 phone portrait", layoutFor(390, 700, 220)],
  ["667x230 phone landscape", layoutFor(667, 230, 140)],
  ["336x716 tablet column", layoutFor(336, 716, 220)],
  ["1000x700 desktop", layoutFor(1000, 700, 220)],
  ["1380x1028 wide desktop", layoutFor(1380, 1028, 280)]
];

describe("randomSafePosition", () => {
  for (const [name, layout] of MATRIX) {
    it(`${name}: never overlaps the circle and never leaves the area (5000 samples)`, () => {
      const { areaW, areaH, circle } = layout;
      for (let i = 0; i < 5000; i++) {
        const { xPct, yPct } = randomSafePosition(layout);
        const x = (xPct / 100) * areaW;
        const y = (yPct / 100) * areaH;
        // fully inside the area (the area clips overflow)
        expect(x - PICKUP_RADIUS_PX).toBeGreaterThanOrEqual(0);
        expect(x + PICKUP_RADIUS_PX).toBeLessThanOrEqual(areaW);
        expect(y - PICKUP_RADIUS_PX).toBeGreaterThanOrEqual(0);
        expect(y + PICKUP_RADIUS_PX).toBeLessThanOrEqual(areaH);
        // the pickup's disc is clear of the circle's disc
        expect(Math.hypot(x - circle.cx, y - circle.cy)).toBeGreaterThanOrEqual(
          circle.r + PICKUP_RADIUS_PX
        );
      }
    });
  }

  // Regression: the old rule was "30% of the area's box from its centre", which
  // is 96px horizontally on a 320px phone — inside the 110px circle radius — so
  // pickups (z-index above the circle) could land on the thing being clicked.
  it("regression: on a 320px-wide phone the old percentage zone would have overlapped the circle", () => {
    const layout = layoutFor(320, 424, 220);
    // The old zone allowed any point >= 30% from the centre; e.g. dx = 30% of 320 = 96px.
    const oldAllowed = { x: 160 + 96, y: layout.circle.cy };
    const oldOverlap =
      Math.hypot(oldAllowed.x - layout.circle.cx, oldAllowed.y - layout.circle.cy) <
      layout.circle.r + PICKUP_RADIUS_PX;
    expect(oldOverlap).toBe(true);

    // …while the new function never produces such a point (covered by the matrix
    // above); spot-check with a sampler pinned toward the circle's side.
    const pinned = randomSafePosition(layout, () => 0.82);
    const x = (pinned.xPct / 100) * 320;
    const y = (pinned.yPct / 100) * 424;
    expect(Math.hypot(x - layout.circle.cx, y - layout.circle.cy)).toBeGreaterThanOrEqual(
      layout.circle.r + PICKUP_RADIUS_PX
    );
  });

  it("falls back to the corner farthest from the circle when sampling can't find room", () => {
    // A circle filling the area: nothing is clear, so we get a corner (inside the area).
    const layout: PlacementLayout = {
      areaW: 200,
      areaH: 200,
      circle: { cx: 100, cy: 60, r: 200 }
    };
    const { xPct, yPct } = randomSafePosition(layout);
    expect(yPct).toBeGreaterThan(50); // the corner farthest from a circle centred high up is a bottom one
    expect([32 / 2, 100 - 32 / 2].some((v) => Math.abs(xPct - v) < 20)).toBe(true);
    expect(xPct).toBeGreaterThanOrEqual(0);
    expect(xPct).toBeLessThanOrEqual(100);
  });

  it("stays inside a degenerate area smaller than a pickup", () => {
    const { xPct, yPct } = randomSafePosition({
      areaW: 40,
      areaH: 40,
      circle: { cx: 20, cy: 20, r: 10 }
    });
    for (const v of [xPct, yPct]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("uses the injected random source (deterministic)", () => {
    const a = randomSafePosition(DEFAULT_LAYOUT, () => 0.9);
    const b = randomSafePosition(DEFAULT_LAYOUT, () => 0.9);
    expect(a).toEqual(b);
  });
});
