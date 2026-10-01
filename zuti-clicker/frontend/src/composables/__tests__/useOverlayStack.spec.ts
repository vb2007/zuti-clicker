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

  it("steps back off a stale sentinel reached via Forward with nothing open", () => {
    popstate({ zutiOverlay: true });
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("ignores an ordinary popstate with nothing open", () => {
    popstate({ position: 1 });
    expect(back).not.toHaveBeenCalled();
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
