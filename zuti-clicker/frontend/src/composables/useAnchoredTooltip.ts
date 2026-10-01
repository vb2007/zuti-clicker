import { ref, computed, useId, onUnmounted } from "vue";

export interface AnchoredTooltipStyle {
  /** Set when the tooltip sits below its anchor. */
  top?: string;
  /** Set (instead of `top`) when it flips above, so no height measurement is needed. */
  bottom?: string;
  left: string;
  /** The width actually used — clamped to the viewport, so TooltipCard can't render wider than it. */
  width: string;
}

/**
 * Shared behavior behind UnitCard's and UpgradeTile's info tooltip: open on
 * hover/focus of a specific anchor element — or on demand (`open`/`toggle`,
 * for a tap or a long-press, where there is no hover) — positioned via that
 * anchor's own viewport rect (so it works whether the caller is teleported,
 * inside a scrollable rail, or a mobile sheet with its own `transform`), and
 * closed on scroll/resize or a pointer press elsewhere rather than left to go
 * stale. Extracted from UnitCard.vue so UpgradeTile.vue doesn't have to
 * duplicate it.
 *
 * `estimatedHeight` is a deliberately conservative guess at the tooltip's
 * rendered height, used only to decide whether it fits below the anchor or
 * should flip above it (an anchor near the bottom of the screen — typical on
 * a phone — otherwise gets a tooltip cut off by the viewport edge).
 */
export function useAnchoredTooltip(width = 220, estimatedHeight = 190) {
  const hovered = ref(false);
  const focused = ref(false);
  // Opened on demand (tap / long-press) — survives mouseleave/blur until
  // something explicitly closes it.
  const pinned = ref(false);
  const visible = computed(() => hovered.value || focused.value || pinned.value);
  const tooltipId = useId();

  const anchorRef = ref<HTMLElement | null>(null);
  const style = ref<AnchoredTooltipStyle | null>(null);
  const VIEWPORT_MARGIN = 8;
  const GAP = 8;
  // A tap opens a tooltip via focus/hover AND then fires click — which must not
  // immediately toggle it shut again.
  const TOGGLE_GRACE_MS = 350;
  let openedAt = 0;

  // Computed once, on open — does not track the anchor continuously (see
  // close() below for what happens if the page scrolls while it's open).
  function position(): void {
    const el = anchorRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - VIEWPORT_MARGIN * 2);
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, window.innerWidth - w - VIEWPORT_MARGIN));

    const fitsBelow = rect.bottom + GAP + estimatedHeight <= window.innerHeight - VIEWPORT_MARGIN;
    const fitsAbove = rect.top - GAP - estimatedHeight >= VIEWPORT_MARGIN;
    const common = { left: `${left}px`, width: `${w}px` };
    if (fitsBelow) {
      style.value = { ...common, top: `${rect.bottom + GAP}px` };
    } else if (fitsAbove) {
      style.value = { ...common, bottom: `${window.innerHeight - rect.top + GAP}px` };
    } else {
      // Room neither way (a short phone-landscape screen, an anchor mid-list): slide it
      // up just far enough to stay inside the viewport, overlapping the anchor. The
      // tooltip never takes pointer events, so covering the anchor is harmless.
      const top = Math.max(
        VIEWPORT_MARGIN,
        Math.min(rect.bottom + GAP, window.innerHeight - estimatedHeight - VIEWPORT_MARGIN)
      );
      style.value = { ...common, top: `${top}px` };
    }
  }

  function noteOpening(): void {
    if (!visible.value) openedAt = Date.now();
  }

  function onEnter(): void {
    noteOpening();
    hovered.value = true;
    position();
  }
  function onLeave(): void {
    hovered.value = false;
  }
  function onFocus(): void {
    noteOpening();
    focused.value = true;
    position();
  }
  function onBlur(): void {
    focused.value = false;
  }

  /** Opens it and keeps it open until closed (a long-press preview). */
  function open(): void {
    noteOpening();
    pinned.value = true;
    position();
  }

  /**
   * A tap on the anchor: opens it, or — if it has been open a moment — closes it.
   * (On touch the very same tap that focuses/hovers the anchor also clicks it;
   * the grace period stops that click from closing what it just opened.)
   */
  function toggle(): void {
    if (visible.value && Date.now() - openedAt > TOGGLE_GRACE_MS) {
      close();
      return;
    }
    open();
  }

  // A capture-phase listener catches scrolling on an ancestor's own
  // `overflow-y: auto` (the shop panel's list), which doesn't bubble to
  // window the way a normal listener would need.
  function close(): void {
    hovered.value = false;
    focused.value = false;
    pinned.value = false;
  }

  // A press anywhere outside the anchor dismisses it — on touch there is no
  // mouseleave, and a pinned tooltip would otherwise stay until a scroll.
  function onOutsidePointerDown(e: PointerEvent): void {
    if (!visible.value) return;
    if (anchorRef.value?.contains(e.target as Node)) return;
    close();
  }

  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close);
  document.addEventListener("pointerdown", onOutsidePointerDown, true);
  onUnmounted(() => {
    window.removeEventListener("scroll", close, true);
    window.removeEventListener("resize", close);
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
  });

  return {
    anchorRef,
    visible,
    tooltipId,
    style,
    onEnter,
    onLeave,
    onFocus,
    onBlur,
    open,
    close,
    toggle
  };
}
