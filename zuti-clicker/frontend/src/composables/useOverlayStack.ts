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
 *
 * Which overlay is "top" is decided by priority first (modals pass their
 * z-index, so Back/Escape always reach the one the player can actually see on
 * top), then by registration order. A modal that mounts late — the guest
 * warning, only once the session check returns — must not jump the queue.
 */

interface Entry {
  close: () => void;
  priority: number;
}

const SENTINEL_KEY = "zutiOverlay";

const stack: Entry[] = [];
// True while the current history entry is our sentinel.
let armed = false;
// popstate events caused by our own history.back() calls, to be ignored.
let pendingBack = 0;
let listening = false;

// `history.state` survives a reload: a sentinel left current by a reload with an
// overlay open is stale (nothing is open any more) and has to be stepped off.
function stateIsSentinel(): boolean {
  return Boolean((history.state as Record<string, unknown> | null)?.[SENTINEL_KEY]);
}

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
    // An overlay opened while our own history.back() was still in flight could not
    // arm (the queued traversal would have popped the entry it pushed); now that the
    // traversal has landed, give it the sentinel it was denied.
    if (pendingBack === 0 && stack.length > 0 && !armed) arm();
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
  // A held Escape auto-repeats: without this it would peel the whole stack in one
  // press (Settings' close even reverts its unsaved changes).
  if (e.repeat || e.isComposing) return;
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
  // Left current by a reload with an overlay open: step off it (our own back(),
  // so its popstate is swallowed) rather than make the player press Back for it.
  if (stateIsSentinel()) {
    pendingBack++;
    history.back();
  }
}

/**
 * Attaches the listeners and steps off a sentinel left current by a reload, right at app
 * start. Without this a logged-in player — for whom no overlay opens at load — would have
 * the first Back press silently consumed by the stale entry. Idempotent; call it once
 * from App.vue's setup.
 */
export function initOverlayStack(): void {
  ensureListening();
}

export interface OverlayHandle {
  release: () => void;
}

/**
 * Registers `close` as an overlay. The top-most is the highest `priority`, ties
 * going to the most recently registered. Idempotent release.
 */
export function registerOverlay(close: () => void, priority = 0): OverlayHandle {
  ensureListening();
  const entry: Entry = { close, priority };
  // Insert after every entry of equal-or-lower priority (stable by registration).
  let at = stack.length;
  while (at > 0 && stack[at - 1]!.priority > priority) at--;
  stack.splice(at, 0, entry);
  // While our own history.back() is still in flight, a push now would be popped by it;
  // onPopState arms once it has landed.
  if (!armed && pendingBack === 0) arm();

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
export function useOverlay(isOpen: () => boolean, close: () => void, priority = 0): void {
  let handle: OverlayHandle | null = null;
  watch(
    isOpen,
    (open) => {
      if (open && !handle) handle = registerOverlay(close, priority);
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

/** Test helper: drops all registrations and detaches the listeners (they re-attach on next use). */
export function __resetOverlayStackForTests(): void {
  stack.length = 0;
  armed = false;
  pendingBack = 0;
  if (listening) {
    window.removeEventListener("popstate", onPopState);
    window.removeEventListener("keydown", onKeydown);
    listening = false;
  }
}
