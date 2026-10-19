// Pure pan/zoom maths for the Academic Career canvas (components/career/
// CareerCanvas.vue). A view maps world coordinates to screen ones as
// screen = world x scale + (x, y). Kept DOM-free so every gesture's geometry —
// pinch around a midpoint, wheel around the cursor, fit, clamping — is
// unit-tested without a browser.

export interface View {
  x: number;
  y: number;
  scale: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Scales by `factor` while keeping the world point under the screen point
 * (px, py) exactly where it is — what a pinch's midpoint, a wheel's cursor or a
 * double-tap's finger expects.
 */
export function zoomAround(
  view: View,
  factor: number,
  px: number,
  py: number,
  minScale: number,
  maxScale: number
): View {
  const scale = clamp(view.scale * factor, minScale, maxScale);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** The view that shows `box` (world coords) centred in a vw x vh viewport with `pad` px around it. */
export function fitView(
  box: Box,
  vw: number,
  vh: number,
  pad: number,
  minScale: number,
  maxScale: number
): View {
  const w = Math.max(1, box.maxX - box.minX);
  const h = Math.max(1, box.maxY - box.minY);
  const scale = clamp(Math.min((vw - pad * 2) / w, (vh - pad * 2) / h), minScale, maxScale);
  return {
    scale,
    x: vw / 2 - ((box.minX + box.maxX) / 2) * scale,
    y: vh / 2 - ((box.minY + box.maxY) / 2) * scale
  };
}

/** The view centred on world point (wx, wy) at `scale`. */
export function centerOn(wx: number, wy: number, scale: number, vw: number, vh: number): View {
  return { scale, x: vw / 2 - wx * scale, y: vh / 2 - wy * scale };
}

/**
 * Keeps the world from being flung off screen: the viewport's centre always
 * stays over the world's (padded) box, so there is always tree to grab.
 */
export function clampView(view: View, world: Box, vw: number, vh: number): View {
  const cx = vw / 2;
  const cy = vh / 2;
  const left = world.minX * view.scale + view.x;
  const right = world.maxX * view.scale + view.x;
  const top = world.minY * view.scale + view.y;
  const bottom = world.maxY * view.scale + view.y;
  let { x, y } = view;
  if (left > cx) x -= left - cx;
  if (right < cx) x += cx - right;
  if (top > cy) y -= top - cy;
  if (bottom < cy) y += cy - bottom;
  return { scale: view.scale, x, y };
}

/** Pans `view` the least amount that brings world point (wx, wy) inside the viewport with `margin` px. */
export function revealPoint(
  view: View,
  wx: number,
  wy: number,
  vw: number,
  vh: number,
  margin: number
): View {
  const sx = wx * view.scale + view.x;
  const sy = wy * view.scale + view.y;
  let { x, y } = view;
  if (sx < margin) x += margin - sx;
  if (sx > vw - margin) x -= sx - (vw - margin);
  if (sy < margin) y += margin - sy;
  if (sy > vh - margin) y -= sy - (vh - margin);
  return { scale: view.scale, x, y };
}
