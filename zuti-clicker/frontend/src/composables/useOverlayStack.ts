import { nextTick, getCurrentScope, onScopeDispose, watch } from "vue";

/**
 * One place that decides which open overlay (modal, mobile sheet, ceremony)
 * an Escape key or the browser/Android Back button should dismiss.
 *
 * Why it exists: every modal used to listen for Escape on its own, so a
 * stacked pair (e.g. the delete-confirm over Settings) both closed at once;
 * and on phones — no Escape key — the Back button navigated away from the
 * game instead of closing the open overlay.
 *
 * Back handling: while at least one overlay is open, exactly one "sentinel"
 * history entry sits above the real one. Pressing Back pops the sentinel
 * (the page stays put) and closes the top overlay; if overlays remain, the
 * sentinel is pushed again. When the last overlay is closed some other way
 * (✕, backdrop, Escape), the now-unneeded sentinel is consumed with
 * history.back() so the player's history isn't polluted.
 *
 * The sentinel copies the current history.state: vue-router (mounted with no
 * routes) stores its own bookkeeping there and reads it on every popstate.
 */

interface Entry {
  close: () => void;
}

const SENTINEL_KEY = "zutiOverlay";

const stack: Entry[] = [];
// True while the current history entry is our sentinel.
let armed = false;
// popstate events caused by our own history.back() calls, to be ignored.
let pendingBack = 0;
let listening = false;

function arm(): void {
  history.pushState({ ...(history.state ?? {}), [SENTINEL_KEY]: true }, "");
  armed = true;
}

function consumeSentinel(): void {
  armed = false;
  pendingBack++;
  history.back();
}

// A popstate (or a refused close, e.g. Settings mid-save) can leave overlays
// open without a sentinel under them — put it back once the close has settled.
async function rearmIfNeeded(): Promise<void> {
  await nextTick();
  if (stack.length > 0 && !armed) arm();
}

function closeTop(): void {
  stack[stack.length - 1]?.close();
}

function onPopState(e: PopStateEvent): void {
  if (pendingBack > 0) {
    pendingBack--;
    return;
  }
  if (stack.length > 0) {
    // The browser already popped the sentinel for us.
    armed = false;
    closeTop();
    void rearmIfNeeded();
    return;
  }
  // Forward-navigated onto a stale sentinel with nothing open: step back off it.
  if ((e.state as Record<string, unknown> | null)?.[SENTINEL_KEY]) consumeSentinel();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && stack.length > 0) {
    closeTop();
    void rearmIfNeeded();
  }
}

function ensureListening(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("popstate", onPopState);
  window.addEventListener("keydown", onKeydown);
}

export interface OverlayHandle {
  release: () => void;
}

/** Registers `close` as the newest (top-most) overlay. Idempotent release. */
export function registerOverlay(close: () => void): OverlayHandle {
  ensureListening();
  const entry: Entry = { close };
  stack.push(entry);
  if (!armed) arm();

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      // Deferred a microtask so an overlay handing over to another in the same
      // tick (guest warning → auth modal) doesn't churn history.
      queueMicrotask(() => {
        if (stack.length === 0 && armed) consumeSentinel();
      });
    }
  };
}

/**
 * Component helper: keeps `close` registered for as long as `isOpen()` is true.
 * Must be called from setup().
 */
export function useOverlay(isOpen: () => boolean, close: () => void): void {
  let handle: OverlayHandle | null = null;
  watch(
    isOpen,
    (open) => {
      if (open && !handle) handle = registerOverlay(close);
      else if (!open && handle) {
        handle.release();
        handle = null;
      }
    },
    { immediate: true }
  );
  if (getCurrentScope()) {
    onScopeDispose(() => {
      handle?.release();
      handle = null;
    });
  }
}

/** Test helper: drops all registrations and listeners' state. */
export function __resetOverlayStackForTests(): void {
  stack.length = 0;
  armed = false;
  pendingBack = 0;
}
