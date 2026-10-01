import { describe, it, expect } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useMediaQuery } from "@/composables/useMediaQuery";

function setViewport(size: { width?: number; height?: number }) {
  (
    globalThis as unknown as { happyDOM: { setViewport: (o: object) => void } }
  ).happyDOM.setViewport(size);
}

function mountWith(query: string) {
  let result: ReturnType<typeof useMediaQuery> | undefined;
  const wrapper = mount(
    defineComponent({
      setup() {
        result = useMediaQuery(query);
        return () => null;
      }
    })
  );
  return { wrapper, matches: result!.matches };
}

describe("useMediaQuery", () => {
  it("reflects a width query and updates when the viewport changes", () => {
    setViewport({ width: 1440, height: 900 });
    const { matches } = mountWith("(max-width: 480px)");
    expect(matches.value).toBe(false);
    setViewport({ width: 400, height: 900 });
    expect(matches.value).toBe(true);
  });

  // happy-dom evaluates single conditions only (a comma-separated list or
  // `or` never matches), so callers needing "A or B" combine two refs.
  it("supports height queries", () => {
    setViewport({ width: 667, height: 800 });
    const { matches } = mountWith("(max-height: 500px)");
    expect(matches.value).toBe(false);
    setViewport({ width: 667, height: 375 });
    expect(matches.value).toBe(true);
  });

  it("stops updating after the component unmounts", () => {
    setViewport({ width: 1440, height: 900 });
    const { wrapper, matches } = mountWith("(max-width: 480px)");
    wrapper.unmount();
    setViewport({ width: 400, height: 900 });
    expect(matches.value).toBe(false);
  });
});
