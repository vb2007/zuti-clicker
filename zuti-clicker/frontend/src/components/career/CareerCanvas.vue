<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useGameStore } from "@/stores/gameStore";
import {
  CAREER_NODES,
  CAREER_NODES_BY_ID,
  CAREER_BRANCHES,
  type CareerNode
} from "@/utils/careerCore";
import { layoutCareerTree } from "@/utils/careerLayout";
import {
  careerNodeName,
  careerNodeState,
  romanTier,
  type CareerNodeState
} from "@/utils/careerText";
import {
  zoomAround,
  fitView,
  clampView,
  centerOn,
  revealPoint,
  clamp,
  type View,
  type Box
} from "@/utils/panZoom";
import CareerIcon from "./CareerIcon.vue";

/**
 * The Academic Career tree as a pan/zoom canvas: the root at the bottom, the
 * six branches climbing from it. One transformed layer holds an SVG of the
 * edges and real <button>s for the nodes, so a node is focusable, labelled
 * and clickable like any other control; only that layer's transform changes
 * while panning or zooming.
 *
 * Input is Pointer Events throughout — mouse, touch and pen are one code path:
 * one finger (or the mouse) drags, two fingers pinch around their midpoint,
 * the wheel zooms around the cursor, a double tap/click zooms in there. A drag
 * past DRAG_SLOP never selects the node it started on. Keyboard: arrows walk
 * the tree (up to a child, down to the parent, left/right along the row) with
 * a roving tabindex, so the tree is one Tab stop.
 */

// bottomInset: how much of the canvas's bottom is covered (the phone sheet), so
// a selected node is brought into the part the player can still see.
const props = withDefaults(defineProps<{ selectedId: string | null; bottomInset?: number }>(), {
  bottomInset: 0
});
const emit = defineEmits<{ select: [id: string]; deselect: []; legend: [] }>();

const { t } = useI18n();
const game = useGameStore();

const COL_W = 64;
const ROW_H = 92;
const PAD = 96;
const DRAG_SLOP = 6;
const MAX_SCALE = 2;
// The smallest starting scale per input: a coarse pointer opens at full size,
// so every node is a >= 44px touch target before any pinch.
const MIN_START_SCALE_COARSE = 1;
const MIN_START_SCALE_FINE = 0.7;
// A mouse opens on the whole fan — the root and all six trunks — down to this.
const OVERVIEW_MIN_SCALE = 0.32;
// Below this, tier numerals would be a few pixels tall: hidden, shapes only.
const NUMERAL_MIN_SCALE = 0.5;

const layout = layoutCareerTree(CAREER_NODES);

// The fan: the root sits ROOT_DROP rows below the trunk heads, and each
// branch climbs higher the further out it is (BRANCH_LIFT rows per step from
// the middle), so the six root edges visibly radiate upward instead of
// reading as one flat rail. Rendering only — the grid (careerLayout) and so
// every parent/child relation stay as tested.
const ROOT_DROP = 2.5;
const BRANCH_LIFT = 0.9;
const branchLiftRows = new Map(
  CAREER_BRANCHES.map((b, i) => [b, Math.abs(i - (CAREER_BRANCHES.length - 1) / 2) - 0.5])
);
const maxLift = Math.max(...[...branchLiftRows.values()]) * BRANCH_LIFT;
const worldW = (layout.maxCol - layout.minCol) * COL_W + PAD * 2;
const worldH = (layout.maxRow + maxLift + ROOT_DROP) * ROW_H + PAD * 2;
const WORLD_BOX: Box = { minX: 0, minY: 0, maxX: worldW, maxY: worldH };
// Row 0 (the root) sits at the bottom; everything else is lifted above it.
const baseY = (layout.maxRow + maxLift + ROOT_DROP) * ROW_H + PAD;

function pos(id: string): { x: number; y: number } {
  const p = layout.nodes.get(id)!;
  const node = CAREER_NODES_BY_ID.get(id)!;
  const x = (p.col - layout.minCol) * COL_W + PAD;
  if (node.branch === "root") return { x, y: baseY };
  const lift = (branchLiftRows.get(node.branch) ?? 0) * BRANCH_LIFT;
  return { x, y: baseY - (p.row - 1 + ROOT_DROP + lift) * ROW_H };
}

function sizeOf(node: CareerNode): number {
  if (node.parent === null) return 72;
  return node.keystone ? 56 : 44;
}

const ownedMap = computed(
  () => new Map(game.careerNodes.map((n) => [n.nodeId, { refundable: n.refundable }]))
);

const nodes = computed(() =>
  CAREER_NODES.map((node) => {
    const state = careerNodeState(node, ownedMap.value, game.phdCount, game.careerWindowOpen);
    const { x, y } = pos(node.id);
    const name = careerNodeName(t, node);
    return {
      node,
      x,
      y,
      size: sizeOf(node),
      state,
      name,
      label: t("career.nodeAria", { name, state: stateLabel(state) })
    };
  })
);

function stateLabel(state: CareerNodeState): string {
  return {
    owned: t("career.stateOwned"),
    refundable: t("career.stateRefundable"),
    buyable: t("career.stateBuyable"),
    available: t("career.stateAvailable"),
    locked: t("career.stateLocked")
  }[state];
}

// Edges climb from parent to child: straight within a column, otherwise an
// S-curve that leaves the parent upward and arrives at the child from below.
const edges = computed(() =>
  layout.edges.map((e) => {
    const a = pos(e.from);
    const b = pos(e.to);
    const mid = (a.y + b.y) / 2;
    const d =
      a.x === b.x
        ? `M${a.x} ${a.y}V${b.y}`
        : `M${a.x} ${a.y}C${a.x} ${mid} ${b.x} ${mid} ${b.x} ${b.y}`;
    const fromOwned = ownedMap.value.has(e.from);
    const toOwned = ownedMap.value.has(e.to);
    return { key: e.to, d, kind: fromOwned && toOwned ? "owned" : fromOwned ? "open" : "dim" };
  })
);

// Branch names sit just under each trunk's first keystone — in screen space
// (see branchLabels below), so they stay readable at any zoom.
const BRANCH_ANCHORS = CAREER_BRANCHES.map((b) => {
  const head = CAREER_NODES.find((n) => n.branch === b && n.keystone)!;
  const p = pos(head.id);
  return { branch: b, x: p.x, y: p.y + ROW_H * 0.55 };
});

// ---- View ---------------------------------------------------------------

const viewportEl = ref<HTMLElement | null>(null);
const view = ref<View>({ x: 0, y: 0, scale: 1 });
const vw = ref(0);
const vh = ref(0);
const minScale = computed(() =>
  Math.min(0.3, fitView(WORLD_BOX, vw.value || 1, vh.value || 1, 24, 0.01, MAX_SCALE).scale)
);

function setView(v: View): void {
  view.value = clampView(v, WORLD_BOX, vw.value, vh.value);
}

// A label whose trunk is just past an edge is held inside the canvas (never
// "ESEARCH"); one whose trunk is far off screen is hidden rather than pinned
// to the edge over some other branch.
const branchLabels = computed(() =>
  BRANCH_ANCHORS.flatMap((a) => {
    const text = t(`career.branches.${a.branch}`);
    const half = text.length * 4.2 + 12;
    const x = a.x * view.value.scale + view.value.x;
    if (x < -half || x > vw.value + half) return [];
    return [
      {
        branch: a.branch,
        text,
        left: clamp(x, half + 8, Math.max(half + 8, vw.value - half - 8)),
        top: a.y * view.value.scale + view.value.y
      }
    ];
  })
);
const lowZoom = computed(() => view.value.scale < NUMERAL_MIN_SCALE);

const worldStyle = computed(() => ({
  width: `${worldW}px`,
  height: `${worldH}px`,
  transform: `translate3d(${view.value.x}px, ${view.value.y}px, 0) scale(${view.value.scale})`
}));

function isCoarse(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/**
 * Opens on what matters now. A mouse gets the whole fan — the root and the
 * six trunk heads — so the tree's shape is the first thing seen; a finger
 * gets full-size targets around the frontier (Fit shows the whole tree).
 */
function initialView(): View {
  if (!isCoarse()) {
    const xs = BRANCH_ANCHORS.map((a) => a.x);
    const root = pos(CAREER_NODES[0]!.id);
    const top = Math.min(...BRANCH_ANCHORS.map((a) => a.y)) - ROW_H * 3;
    const fan = fitView(
      { minX: Math.min(...xs) - 80, maxX: Math.max(...xs) + 80, minY: top, maxY: root.y + 60 },
      vw.value,
      vh.value,
      16,
      minScale.value,
      MIN_START_SCALE_FINE
    );
    // Root near the bottom edge: the width sets the scale, and the spare
    // height goes to the tree above it rather than empty canvas below.
    if (fan.scale >= OVERVIEW_MIN_SCALE) return { ...fan, y: vh.value - 70 - root.y * fan.scale };
  }
  const frontier = nodes.value.filter((n) => n.state !== "locked");
  const xs = frontier.map((n) => n.x);
  const ys = frontier.map((n) => n.y);
  const box: Box = {
    minX: Math.min(...xs) - 40,
    maxX: Math.max(...xs) + 40,
    minY: Math.min(...ys) - 40,
    maxY: Math.max(...ys) + 40
  };
  const fitted = fitView(box, vw.value, vh.value, 24, minScale.value, 1);
  const floor = isCoarse() ? MIN_START_SCALE_COARSE : MIN_START_SCALE_FINE;
  if (fitted.scale >= floor) return fitted;
  // Too wide to fit legibly (a phone): start readable, on the root.
  const root = pos(CAREER_NODES[0]!.id);
  return centerOn(root.x, root.y - (vh.value / floor) * 0.3, floor, vw.value, vh.value);
}

function zoomBy(factor: number, px = vw.value / 2, py = vh.value / 2): void {
  setView(zoomAround(view.value, factor, px, py, minScale.value, MAX_SCALE));
}

function fitAll(): void {
  setView(fitView(WORLD_BOX, vw.value, vh.value, 24, minScale.value, MAX_SCALE));
}

let resizeObserver: ResizeObserver | null = null;
let initialised = false;
function measure(): void {
  const el = viewportEl.value;
  if (!el) return;
  vw.value = el.clientWidth;
  vh.value = el.clientHeight;
  if (!initialised && vw.value > 0 && vh.value > 0) {
    initialised = true;
    setView(initialView());
  } else {
    setView(view.value);
  }
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver === "function" && viewportEl.value) {
    resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(viewportEl.value);
  }
});
onUnmounted(() => resizeObserver?.disconnect());

// ---- Gestures -------------------------------------------------------------

const pointers = new Map<number, { x: number; y: number }>();
let dragStart: { x: number; y: number; view: View } | null = null;
let pinchStart: { dist: number; mid: { x: number; y: number }; view: View } | null = null;
let moved = false;
// Set once a gesture moved, so the click its release would fire is swallowed.
let suppressClick = false;
let lastTap: { time: number; x: number; y: number } | null = null;
const dragging = ref(false);

function local(e: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
  const r = viewportEl.value!.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pinchGeometry(): { dist: number; mid: { x: number; y: number } } {
  const [a, b] = [...pointers.values()];
  return {
    dist: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
    mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 }
  };
}

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    moved = false;
    suppressClick = false;
    dragStart = { ...p, view: { ...view.value } };
  } else if (pointers.size === 2) {
    pinchStart = { ...pinchGeometry(), view: { ...view.value } };
    moved = true;
    suppressClick = true;
    dragging.value = true;
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return;
  // A mouse released outside the canvas before a drag took capture never sent
  // its pointerup here: with no button held any more, the press is over.
  if (e.pointerType !== "touch" && e.buttons === 0) {
    onPointerUp(e);
    return;
  }
  pointers.set(e.pointerId, local(e));
  if (pointers.size >= 2 && pinchStart) {
    const g = pinchGeometry();
    const z = zoomAround(
      pinchStart.view,
      g.dist / pinchStart.dist,
      pinchStart.mid.x,
      pinchStart.mid.y,
      minScale.value,
      MAX_SCALE
    );
    setView({
      scale: z.scale,
      x: z.x + g.mid.x - pinchStart.mid.x,
      y: z.y + g.mid.y - pinchStart.mid.y
    });
    return;
  }
  if (!dragStart) return;
  const p = pointers.get(e.pointerId)!;
  const dx = p.x - dragStart.x;
  const dy = p.y - dragStart.y;
  if (!moved && Math.hypot(dx, dy) > DRAG_SLOP) {
    moved = true;
    suppressClick = true;
    dragging.value = true;
    viewportEl.value?.setPointerCapture?.(e.pointerId);
  }
  if (moved) setView({ ...dragStart.view, x: dragStart.view.x + dx, y: dragStart.view.y + dy });
}

function onPointerUp(e: PointerEvent): void {
  if (!pointers.has(e.pointerId)) return;
  const p = pointers.get(e.pointerId)!;
  pointers.delete(e.pointerId);
  if (pointers.size === 1) {
    // A pinch lifted one finger: carry on dragging with the other.
    const [rest] = [...pointers.values()];
    dragStart = { ...rest!, view: { ...view.value } };
    pinchStart = null;
    return;
  }
  if (pointers.size === 2) {
    // Three fingers down to two: measure the pinch afresh from the pair that's
    // left, or the zoom jumps to the ratio against a different pair.
    pinchStart = { ...pinchGeometry(), view: { ...view.value } };
    return;
  }
  if (pointers.size > 0) return;
  dragging.value = false;
  pinchStart = null;
  dragStart = null;
  // A tap/click on empty canvas clears the selection; a double one zooms in there.
  const onNode = (e.target as HTMLElement | null)?.closest?.(".career-node");
  if (!moved && !onNode) {
    emit("deselect");
    const now = performance.now();
    if (lastTap && now - lastTap.time < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
      zoomBy(1.6, p.x, p.y);
      lastTap = null;
    } else {
      lastTap = { time: now, ...p };
    }
  }
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const p = local(e);
  // A trackpad pinch arrives as a ctrl+wheel with small deltas; a mouse wheel
  // notch is ~100. Both map smoothly onto an exponential zoom.
  const unit = e.deltaMode === 1 ? 33 : 1;
  zoomBy(Math.exp(-clamp(e.deltaY * unit, -200, 200) * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
}

function onNodeClick(id: string, e: MouseEvent): void {
  // A click a drag's release fires is swallowed — but a keyboard activation
  // (Enter/Space: detail 0) always goes through, whatever the last gesture was.
  if (suppressClick && e.detail !== 0) return;
  emit("select", id);
}

function onNodeFocus(id: string): void {
  focusId.value = id;
  // Tabbing onto a node off screen brings it into view (the canvas itself
  // never scrolls — see .career-canvas).
  reveal(id);
}

// `overflow: clip` keeps focus from scrolling the canvas; where it isn't
// supported (`hidden` fallback), any scroll a focus move causes is undone.
function onCanvasScroll(): void {
  const el = viewportEl.value;
  if (el && (el.scrollLeft !== 0 || el.scrollTop !== 0)) {
    el.scrollLeft = 0;
    el.scrollTop = 0;
  }
}

// ---- Keyboard -------------------------------------------------------------

const focusId = ref<string>(props.selectedId ?? CAREER_NODES[0]!.id);
const nodeEls = new Map<string, HTMLButtonElement>();
function bindNode(id: string, el: unknown): void {
  if (el instanceof HTMLButtonElement) nodeEls.set(id, el);
  else nodeEls.delete(id);
}

function reveal(id: string): void {
  const { x, y } = pos(id);
  setView(revealPoint(view.value, x, y, vw.value, vh.value - props.bottomInset, 72));
}

function moveFocus(id: string): void {
  focusId.value = id;
  reveal(id);
  void nextTick(() => nodeEls.get(id)?.focus({ preventScroll: true }));
}

function neighbour(id: string, key: string): string | null {
  const here = layout.nodes.get(id)!;
  if (key === "ArrowDown") return CAREER_NODES_BY_ID.get(id)!.parent;
  if (key === "ArrowUp") {
    const children = CAREER_NODES.filter((n) => n.parent === id).map(
      (n) => layout.nodes.get(n.id)!
    );
    children.sort((a, b) => Math.abs(a.col - here.col) - Math.abs(b.col - here.col));
    return children[0]?.id ?? null;
  }
  const dir = key === "ArrowRight" ? 1 : -1;
  const candidates = [...layout.nodes.values()]
    .filter((n) => (n.col - here.col) * dir > 0 && Math.abs(n.row - here.row) <= 1)
    .sort(
      (a, b) =>
        Math.abs(a.row - here.row) * 100 +
        Math.abs(a.col - here.col) -
        (Math.abs(b.row - here.row) * 100 + Math.abs(b.col - here.col))
    );
  return candidates[0]?.id ?? null;
}

function onNodeKeydown(e: KeyboardEvent, id: string): void {
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
  e.preventDefault();
  const next = neighbour(id, e.key);
  if (next) moveFocus(next);
}

// A selection made elsewhere (the panel's "unlocks after" link) is brought into view.
// So is one the phone sheet has just covered.
watch(
  () => [props.selectedId, props.bottomInset] as const,
  ([id]) => {
    if (id) {
      focusId.value = id;
      reveal(id);
    }
  }
);

defineExpose({ zoomBy, fitAll });
</script>

<template>
  <div
    ref="viewportEl"
    class="career-canvas"
    :class="{ dragging }"
    role="group"
    :aria-label="t('career.canvasLabel')"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel="onWheel"
    @scroll="onCanvasScroll"
  >
    <div class="world" :class="{ 'low-zoom': lowZoom }" :style="worldStyle">
      <svg class="edges" :width="worldW" :height="worldH" aria-hidden="true">
        <path v-for="e in edges" :key="e.key" :d="e.d" :class="`edge-${e.kind}`" />
      </svg>

      <button
        v-for="n in nodes"
        :key="n.node.id"
        :ref="(el) => bindNode(n.node.id, el)"
        type="button"
        class="career-node"
        :class="[
          `state-${n.state}`,
          n.node.parent === null ? 'is-root' : n.node.keystone ? 'is-keystone' : 'is-tier',
          { selected: n.node.id === selectedId }
        ]"
        :style="{
          left: `${n.x - n.size / 2}px`,
          top: `${n.y - n.size / 2}px`,
          width: `${n.size}px`,
          height: `${n.size}px`
        }"
        :tabindex="n.node.id === focusId ? 0 : -1"
        :aria-label="n.label"
        :aria-pressed="n.node.id === selectedId"
        :data-node="n.node.id"
        @click="onNodeClick(n.node.id, $event)"
        @focus="onNodeFocus(n.node.id)"
        @keydown="onNodeKeydown($event, n.node.id)"
      >
        <CareerIcon
          v-if="n.node.keystone"
          :branch="n.node.branch"
          :size="n.node.parent === null ? 30 : 22"
        />
        <span v-else class="tier">{{ romanTier(n.node.tier) }}</span>
      </button>
    </div>

    <span
      v-for="b in branchLabels"
      :key="b.branch"
      class="branch-label"
      :style="{ transform: `translate3d(${b.left}px, ${b.top}px, 0) translate(-50%, -50%)` }"
      aria-hidden="true"
    >
      {{ b.text }}
    </span>

    <!-- Lifted above the phone sheet while it is open. -->
    <div
      class="zoom-controls"
      :class="{ lifted: bottomInset > 0 }"
      :style="bottomInset > 0 ? { transform: `translateY(${-bottomInset}px)` } : undefined"
      @pointerdown.stop
    >
      <button
        type="button"
        class="zoom-btn"
        :aria-label="t('career.legendBtn')"
        @click="emit('legend')"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M6 6.2a2 2 0 1 1 2.8 1.8c-.5.2-.8.7-.8 1.2V10M8 12.6v.1"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button type="button" class="zoom-btn" :aria-label="t('career.zoomIn')" @click="zoomBy(1.4)">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M8 3v10M3 8h10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button
        type="button"
        class="zoom-btn"
        :aria-label="t('career.zoomOut')"
        @click="zoomBy(1 / 1.4)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M3 8h10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      </button>
      <button type="button" class="zoom-btn" :aria-label="t('career.fit')" @click="fitAll">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.career-canvas {
  position: relative;
  /* clip, not hidden: a hidden box still scrolls when focus lands on a node
     outside it, which would knock the drawing out of step with the view. */
  overflow: hidden;
  overflow: clip;
  /* Every gesture on the canvas is ours: no browser pan, zoom or text selection. */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  cursor: grab;
  background: var(--bg-base);
}
.career-canvas.dragging {
  cursor: grabbing;
}

.world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
  /* A faint dot grid on the tree's own spacing — it moves with the tree, so a
     drag reads as moving the board, not sliding a picture. */
  background-image: radial-gradient(circle, var(--border) 1px, transparent 1.6px);
  background-size: 64px 46px;
  background-position: 32px 23px;
}

.edges {
  position: absolute;
  left: 0;
  top: 0;
  overflow: visible;
}
.edges path {
  fill: none;
  stroke-linecap: round;
}
.edge-dim {
  stroke: var(--border);
  stroke-width: 2;
}
.edge-open {
  stroke: var(--accent);
  stroke-opacity: 0.55;
  stroke-width: 2;
  stroke-dasharray: 4 6;
}
.edge-owned {
  stroke: var(--accent);
  stroke-width: 3;
}

.branch-label {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1;
  will-change: transform;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.2px;
  text-transform: uppercase;
  color: var(--text-secondary);
  background: var(--bg-base);
  padding: 2px 8px;
  border-radius: var(--radius-full);
  pointer-events: none;
}

/* ---- Nodes ----------------------------------------------------------- */
.career-node {
  position: absolute;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px solid var(--border);
  background: var(--bg-surface);
  color: var(--text-secondary);
  padding: 0;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast),
    box-shadow var(--transition-fast);
}
.career-node .tier {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.2px;
  font-variant-numeric: tabular-nums;
}

.is-keystone {
  border-width: 2px;
}
.is-root {
  border-width: 2.5px;
}

.state-locked {
  border-style: dashed;
  border-color: var(--text-muted);
  background: var(--bg-surface);
  color: var(--text-secondary);
}
.low-zoom .tier {
  visibility: hidden;
}
.state-available {
  border-color: var(--text-secondary);
  background: var(--bg-card);
  color: var(--text-primary);
}
.state-buyable {
  border-color: var(--accent);
  border-width: 2.5px;
  background: var(--bg-card);
  color: var(--accent-text);
  box-shadow: 0 3px 14px var(--accent-glow);
}
.state-owned,
.state-refundable {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}
/* Bought in this window — still undoable: the rare-accent dashed ring. */
.state-refundable {
  outline: 2px dashed var(--booster);
  outline-offset: 3px;
}

@media (hover: hover) {
  .career-node:hover {
    border-color: var(--accent-text);
  }
  .state-owned:hover,
  .state-refundable:hover {
    filter: brightness(1.08);
  }
}

/* Selection and keyboard focus share one ring (a box-shadow, so it never
   fights the refundable node's dashed outline). */
.career-node.selected,
.career-node:focus-visible {
  box-shadow:
    0 0 0 3px var(--bg-base),
    0 0 0 5.5px var(--text-primary);
}
.career-node:focus-visible:not(.state-refundable) {
  outline: none;
}

/* ---- Zoom controls -------------------------------------------------------- */
.zoom-controls {
  position: absolute;
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
  left: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 2;
}
.zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast);
}
@media (hover: hover) {
  .zoom-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }
}
/* Above an open phone sheet the controls lie in one row: a column that tall
   would run up under the header. */
.zoom-controls.lifted {
  flex-direction: row;
}
/* Short screens: one row, so the controls cover less of the tree. */
@media (max-height: 500px) {
  .zoom-controls {
    flex-direction: row;
    left: 8px;
    bottom: 8px;
  }
}
@media (pointer: coarse) {
  .zoom-btn {
    width: 44px;
    height: 44px;
  }
}
</style>
