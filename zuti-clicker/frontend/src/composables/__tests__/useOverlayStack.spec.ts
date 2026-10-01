import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import {
  registerOverlay,
  useOverlay,
  __resetOverlayStackForTests
} from "@/composables/useOverlayStack";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
const popstate = (state: unknown = null) =>
  window.dispatchEvent(new PopStateEvent("popstate", { state }));

describe("useOverlayStack", () => {
  let pushState: ReturnType<typeof vi.spyOn>;
  let back: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    __resetOverlayStackForTests();
    // The real History API is stubbed: the stack's contract is "which calls it
    // makes and how it reacts to popstate", not happy-dom's history emulation.
    pushState = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
    back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  });

  afterEach(async () => {
    await flush();
    __resetOverlayStackForTests();
  });

  it("pushes exactly one sentinel entry no matter how many overlays open", () => {
    registerOverlay(() => {});
    registerOverlay(() => {});
    registerOverlay(() => {});
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]![0]).toMatchObject({ zutiOverlay: true });
  });

  it("preserves the existing history.state (vue-router bookkeeping) in the sentinel", () => {
    vi.spyOn(window.history, "state", "get").mockReturnValue({ position: 4, current: "/" });
    registerOverlay(() => {});
    expect(pushState.mock.calls[0]![0]).toMatchObject({ position: 4, current: "/", zutiOverlay: true });
  });

  it("Escape closes only the top-most overlay", () => {
    const bottom = vi.fn();
    const top = vi.fn();
    registerOverlay(bottom);
    registerOverlay(top);
    escape();
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();
  });

  it("Escape does nothing when no overlay is open", () => {
    expect(() => escape()).not.toThrow();
  });

  it("Back (popstate) closes the top overlay and re-arms while others remain open", async () => {
    const bottom = vi.fn();
    const top = vi.fn();
    registerOverlay(bottom);
    const topHandle = registerOverlay(top);
    pushState.mockClear();

    popstate();
    expect(top).toHaveBeenCalledTimes(1);
    expect(bottom).not.toHaveBeenCalled();

    topHandle.release(); // what the real close does
    await nextTick();
    await flush();
    // bottom is still open: its sentinel was popped by Back, so push it again
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("Back re-arms even when the close was refused (overlay stays open)", async () => {
    registerOverlay(() => {
      /* refuses to close, like Settings mid-save */
    });
    pushState.mockClear();
    popstate();
    await nextTick();
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it("Back on the last overlay leaves no stray sentinel behind", async () => {
    const handle = registerOverlay(() => {});
    pushState.mockClear();
    popstate();
    handle.release();
    await nextTick();
    await flush();
    expect(pushState).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled(); // the browser already popped it
  });

  it("closing the last overlay by other means consumes the sentinel, and ignores its popstate", async () => {
    const close = vi.fn();
    const handle = registerOverlay(close);
    handle.release();
    await flush();
    expect(back).toHaveBeenCalledTimes(1);

    popstate(); // the popstate our own back() produces
    expect(close).not.toHaveBeenCalled();
  });

  it("handing over between overlays in one tick does not churn history", async () => {
    const a = registerOverlay(() => {});
    pushState.mockClear();
    a.release();
    registerOverlay(() => {}); // e.g. guest warning → auth modal
    await flush();
    expect(back).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  // The module listens lazily (on first registration). A player who has opened
  // and closed something earlier in the session has listeners attached and the
  // sentinel consumed; reproduce that state explicitly.
  async function attachAndSettle() {
    registerOverlay(() => {}).release();
    await flush(); // consumes the sentinel -> history.back()
    popstate(); // our own back()'s popstate
    pushState.mockClear();
    back.mockClear();
  }

  it("steps back off a stale sentinel reached via Forward with nothing open", async () => {
    await attachAndSettle();
    popstate({ zutiOverlay: true });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("ignores an ordinary popstate with nothing open", async () => {
    await attachAndSettle();
    popstate({ position: 1 });
    expect(back).not.toHaveBeenCalled();
  });

  // Regression (review): close the last overlay, open another a moment later but before
  // our own history.back() has landed. The new overlay's pushState would have been popped
  // by that queued traversal, leaving `armed` true over a non-sentinel entry — so Back
  // left the game (and the next ✕ called back() again).
  it("regression: an overlay opened while our own back() is in flight is armed once it lands", async () => {
    const a = registerOverlay(() => {});
    a.release();
    await flush(); // back() requested, its popstate not yet delivered
    expect(back).toHaveBeenCalledTimes(1);
    pushState.mockClear();

    registerOverlay(() => {});
    expect(pushState).not.toHaveBeenCalled(); // would be popped by the queued traversal

    popstate(); // …the traversal lands
    expect(pushState).toHaveBeenCalledTimes(1); // now it is armed
    expect(pushState.mock.calls[0]![0]).toMatchObject({ zutiOverlay: true });
  });

  // Regression (review): history.state survives a reload, so a sentinel left current
  // while an overlay was open is stale — nothing is open now — and cost an extra Back.
  it("regression: a sentinel left current by a reload is stepped off on first use", async () => {
    vi.spyOn(window.history, "state", "get").mockReturnValue({ position: 2, zutiOverlay: true });
    registerOverlay(() => {});
    expect(back).toHaveBeenCalledTimes(1); // stepping off the stale entry
    expect(pushState).not.toHaveBeenCalled(); // not yet: that back() is still in flight

    vi.spyOn(window.history, "state", "get").mockReturnValue({ position: 1 });
    popstate(); // its popstate arrives
    expect(pushState).toHaveBeenCalledTimes(1); // the open overlay now gets a fresh sentinel
    expect(back).toHaveBeenCalledTimes(1);
  });

  // Regression (review): a held Escape auto-repeats; each repeat used to close the next
  // overlay down, peeling the whole stack (and Settings' close reverts unsaved changes).
  it("regression: a held (auto-repeating) Escape closes one overlay, not the whole stack", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    registerOverlay(lower);
    registerOverlay(upper);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", repeat: true }));
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("Escape during IME composition is not an overlay close", () => {
    const close = vi.fn();
    registerOverlay(close);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true }));
    expect(close).not.toHaveBeenCalled();
  });

  // Regression (review): top-ness was registration order, so the guest warning (z 900, it
  // registers only once /auth/me returns) could take Escape/Back from a visible z-1000 modal.
  it("regression: a higher-priority overlay stays on top even when a lower one registers later", () => {
    const settings = vi.fn(); // z 1000, already open
    const guest = vi.fn(); // z 900, registers afterwards
    registerOverlay(settings, 1000);
    registerOverlay(guest, 900);
    escape();
    expect(settings).toHaveBeenCalledTimes(1);
    expect(guest).not.toHaveBeenCalled();
  });

  it("equal priority: the most recently registered is on top", () => {
    const first = vi.fn();
    const second = vi.fn();
    registerOverlay(first, 1000);
    registerOverlay(second, 1000);
    escape();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it("release is idempotent", async () => {
    const handle = registerOverlay(() => {});
    handle.release();
    handle.release();
    await flush();
    expect(back).toHaveBeenCalledTimes(1);
  });

  describe("useOverlay (component helper)", () => {
    function mountOverlay(open = ref(false), close = vi.fn()) {
      const wrapper = mount(
        defineComponent({
          setup() {
            useOverlay(() => open.value, close);
            return () => null;
          }
        })
      );
      return { wrapper, open, close };
    }

    it("registers while open and releases when it closes", async () => {
      const { open, close } = mountOverlay();
      expect(pushState).not.toHaveBeenCalled();

      open.value = true;
      await nextTick();
      expect(pushState).toHaveBeenCalledTimes(1);
      escape();
      expect(close).toHaveBeenCalledTimes(1);

      open.value = false;
      await nextTick();
      await flush();
      expect(back).toHaveBeenCalledTimes(1);
    });

    it("registers immediately when already open on mount", () => {
      mountOverlay(ref(true));
      expect(pushState).toHaveBeenCalledTimes(1);
    });

    it("releases on unmount", async () => {
      const { wrapper } = mountOverlay(ref(true));
      wrapper.unmount();
      await flush();
      expect(back).toHaveBeenCalledTimes(1);
    });
  });
});
