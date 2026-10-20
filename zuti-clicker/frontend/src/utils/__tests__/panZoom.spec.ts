import { describe, it, expect } from "vitest";
import { zoomAround, fitView, clampView, centerOn, revealPoint, type View } from "@/utils/panZoom";

const toScreen = (v: View, wx: number, wy: number) => [wx * v.scale + v.x, wy * v.scale + v.y];

describe("panZoom", () => {
  it("zooming keeps the world point under the pinch/cursor fixed", () => {
    const v: View = { x: 40, y: -20, scale: 0.8 };
    const [px, py] = [180, 260];
    const wx = (px - v.x) / v.scale;
    const wy = (py - v.y) / v.scale;
    const z = zoomAround(v, 1.7, px, py, 0.1, 4);
    const [sx, sy] = toScreen(z, wx, wy);
    expect(sx).toBeCloseTo(px, 9);
    expect(sy).toBeCloseTo(py, 9);
    expect(z.scale).toBeCloseTo(1.36, 9);
  });

  it("zoom is clamped, and a clamped zoom still pivots on the same point", () => {
    const z = zoomAround({ x: 0, y: 0, scale: 1 }, 100, 50, 50, 0.2, 2);
    expect(z.scale).toBe(2);
    expect(toScreen(z, 50, 50)).toEqual([50, 50]);
  });

  it("fits a box centred with padding", () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 600, 400, 50, 0.01, 5);
    expect(v.scale).toBeCloseTo(0.5, 9);
    expect(toScreen(v, 500, 250)).toEqual([300, 200]);
  });

  it("clamping keeps tree under the viewport centre after a wild fling", () => {
    const world = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    const flung = clampView({ x: 5000, y: -9000, scale: 1 }, world, 400, 400);
    const [left] = toScreen(flung, 0, 0);
    const [, bottom] = toScreen(flung, 0, 1000);
    expect(left).toBeLessThanOrEqual(200);
    expect(bottom).toBeGreaterThanOrEqual(200);
    // ...and leaves an in-bounds view alone.
    const ok = centerOn(500, 500, 1, 400, 400);
    expect(clampView(ok, world, 400, 400)).toEqual(ok);
  });

  it("reveals an off-screen point with the smallest pan", () => {
    const v = revealPoint({ x: 0, y: 0, scale: 1 }, 900, 50, 400, 400, 40);
    expect(toScreen(v, 900, 50)).toEqual([360, 50]);
    const same = revealPoint({ x: 0, y: 0, scale: 1 }, 100, 100, 400, 400, 40);
    expect(same).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
