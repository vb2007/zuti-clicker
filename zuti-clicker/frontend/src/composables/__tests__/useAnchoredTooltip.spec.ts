import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { defineComponent, h, ref, nextTick } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import { useAnchoredTooltip } from "@/composables/useAnchoredTooltip";

type Api = ReturnType<typeof useAnchoredTooltip>;

function setViewport(width: number, height: number) {
  (
    globalThis as unknown as { happyDOM: { setViewport: (o: object) => void } }
  ).happyDOM.setViewport({
    width,
    height
  });
}

function rect(left: number, top: number, width = 40, height = 40): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {}
  } as DOMRect;
}

describe("useAnchoredTooltip", () => {
  let wrapper: VueWrapper | null = null;
  let api: Api;
  let anchor: HTMLElement;

  function mountWithAnchor(width = 220, anchorRect = rect(100, 100)) {
    wrapper = mount(
      defineComponent({
        setup() {
          api = useAnchoredTooltip(width);
          const el = ref<HTMLElement | null>(null);
          return () =>
            h("div", [
              h("button", {
                ref: (e: unknown) => {
                  el.value = e as HTMLElement;
                  api.anchorRef.value = e as HTMLElement;
                }
              }),
              h("p", { id: "elsewhere" }, "elsewhere")
            ]);
        }
      }),
      { attachTo: document.body }
    );
    anchor = wrapper.find("button").element as HTMLElement;
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(anchorRect);
  }

  beforeEach(() => {
    setViewport(1024, 768);
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens below the anchor when there is room", () => {
    mountWithAnchor(220, rect(100, 100));
    api.onEnter();
    expect(api.style.value?.top).toBe("148px"); // anchor bottom (140) + 8
    expect(api.style.value?.bottom).toBeUndefined();
  });

  // Regression: it always opened below, so an anchor near the bottom of the screen (a unit
  // far down a phone's shop sheet) got a tooltip cut off by the viewport edge.
  it("regression: flips above the anchor when it would run off the bottom of the viewport", () => {
    setViewport(390, 700);
    mountWithAnchor(220, rect(100, 640)); // bottom = 680: far less than 190px of room below
    api.onEnter();
    expect(api.style.value?.top).toBeUndefined();
    // anchored by its bottom edge: viewport height (700) - anchor top (640) + 8
    expect(api.style.value?.bottom).toBe("68px");
  });

  // Regression: with room neither above nor below (phone landscape, an anchor mid-list) it
  // used to stay below and run off the bottom of the screen.
  it("regression: with room neither above nor below it slides up to stay inside the viewport", () => {
    setViewport(390, 300);
    mountWithAnchor(220, rect(100, 120)); // 190px fits neither above (112 room) nor below (132)
    api.onEnter();
    // bottom edge (top + 190) lands exactly on viewport bottom - 8 margin
    expect(api.style.value?.top).toBe("102px");
    expect(api.style.value?.bottom).toBeUndefined();
  });

  it("never slides above the top edge, even in a viewport shorter than the tooltip", () => {
    setViewport(390, 150);
    mountWithAnchor(220, rect(100, 60));
    api.onEnter();
    expect(api.style.value?.top).toBe("8px");
  });

  // Regression: the tooltip's width prop was never clamped, so below ~236px of viewport it
  // rendered wider than the screen even though its left edge was clamped.
  it("regression: clamps the width it hands out to the viewport", () => {
    setViewport(200, 600);
    mountWithAnchor(220, rect(10, 100));
    api.onEnter();
    expect(api.style.value?.width).toBe("184px"); // 200 - 2 * 8 margin
    expect(api.style.value?.left).toBe("8px");
  });

  it("keeps a normal-width tooltip at its requested width", () => {
    mountWithAnchor(220, rect(400, 100));
    api.onEnter();
    expect(api.style.value?.width).toBe("220px");
  });

  describe("toggle (a tap on the anchor)", () => {
    it("opens when closed", () => {
      mountWithAnchor();
      api.toggle();
      expect(api.visible.value).toBe(true);
    });

    it("regression: the click that follows the same tap's focus/hover does not shut it again", () => {
      vi.useFakeTimers();
      mountWithAnchor();
      api.onFocus(); // a tap focuses the button…
      api.toggle(); // …and then clicks it, immediately
      expect(api.visible.value).toBe(true);
    });

    it("closes on a later tap", () => {
      vi.useFakeTimers();
      mountWithAnchor();
      api.toggle();
      vi.advanceTimersByTime(1000);
      api.toggle();
      expect(api.visible.value).toBe(false);
    });
  });

  describe("open()/pinned", () => {
    it("stays open through mouseleave and blur until closed", () => {
      mountWithAnchor();
      api.open();
      api.onLeave();
      api.onBlur();
      expect(api.visible.value).toBe(true);
      api.close();
      expect(api.visible.value).toBe(false);
    });
  });

  describe("dismissal", () => {
    it("a press elsewhere closes it; a press on the anchor does not", async () => {
      mountWithAnchor();
      api.open();
      anchor.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(api.visible.value).toBe(true);

      wrapper!
        .find("#elsewhere")
        .element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await nextTick();
      expect(api.visible.value).toBe(false);
    });

    it("closes on scroll and on resize", () => {
      mountWithAnchor();
      api.open();
      window.dispatchEvent(new Event("scroll"));
      expect(api.visible.value).toBe(false);
      api.open();
      window.dispatchEvent(new Event("resize"));
      expect(api.visible.value).toBe(false);
    });

    it("removes its document/window listeners on unmount", () => {
      const removeDoc = vi.spyOn(document, "removeEventListener");
      const removeWin = vi.spyOn(window, "removeEventListener");
      mountWithAnchor();
      wrapper!.unmount();
      wrapper = null;
      expect(removeDoc.mock.calls.map((c) => c[0])).toContain("pointerdown");
      expect(removeWin.mock.calls.map((c) => c[0])).toEqual(
        expect.arrayContaining(["scroll", "resize"])
      );
    });
  });
});
