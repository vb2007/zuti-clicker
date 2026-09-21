import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { useAntiCheat } from "@/composables/useAntiCheat";
import { useAntiCheatStore } from "@/stores/antiCheatStore";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    anticheat: {
      report: vi.fn(),
      status: vi.fn()
    }
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
}));

// Same reason as antiCheatStore.spec.ts: happy-dom's native functions are JS
// reimplementations, which checkNativeIntegrity would otherwise flag on
// every test regardless of anything this file does.
vi.mock("@/utils/integrityChecks", async () => {
  const actual = await vi.importActual<typeof import("@/utils/integrityChecks")>(
    "@/utils/integrityChecks"
  );
  return { ...actual, checkNativeIntegrity: vi.fn(() => []) };
});

// Mounts the composable inside a real component (matches useBoosters.spec.ts's
// pattern) so its onMounted/onUnmounted hooks actually run.
function mountAntiCheat() {
  return mount(
    defineComponent({
      setup: () => {
        useAntiCheat();
        return () => null;
      }
    })
  );
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useAntiCheat", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.anticheat.report).mockReset().mockResolvedValue({
      message: "ok",
      status: "clean",
      restrictedUntil: null,
      strikeCount: 0
    });
    vi.mocked(api.anticheat.status).mockReset().mockResolvedValue({
      isRestricted: false,
      restrictedUntil: null,
      strikeCount: 0
    });
  });

  // Regression: a backgrounded tab / locked screen can suspend the
  // heartbeat's own setInterval for an arbitrary stretch, so the telemetry
  // window must be re-baselined the moment the page comes back to the
  // foreground rather than waiting for the next heartbeat tick to notice.
  it("resets the telemetry window when the page becomes visible again", () => {
    const wrapper = mountAntiCheat();
    const store = useAntiCheatStore();
    const resetWindowSpy = vi.spyOn(store, "resetWindow");

    setVisibility("hidden");
    expect(resetWindowSpy).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(resetWindowSpy).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it("stops listening for visibility changes after unmount", () => {
    const wrapper = mountAntiCheat();
    const store = useAntiCheatStore();
    const resetWindowSpy = vi.spyOn(store, "resetWindow");
    wrapper.unmount();

    setVisibility("visible");
    expect(resetWindowSpy).not.toHaveBeenCalled();
  });
});
