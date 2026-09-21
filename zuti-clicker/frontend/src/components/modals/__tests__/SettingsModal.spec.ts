import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper, flushPromises, type VueWrapper } from "@vue/test-utils";
import SettingsModal from "@/components/modals/SettingsModal.vue";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import { api } from "@/lib/api";
import { DEFAULT_SETTINGS } from "@/utils/settingsSchema";

vi.mock("@/lib/api", () => ({
  api: {
    settings: {
      load: vi.fn(),
      store: vi.fn()
    },
    meta: {
      version: vi.fn()
    }
  },
  ApiError: class ApiError extends Error {}
}));

function loginAs() {
  const auth = useAuthStore();
  auth.user = { id: 1, username: "u", email: "u@example.com" };
}

describe("SettingsModal", () => {
  // SettingsModal registers a `window` keydown listener (for Esc) while open,
  // removed on close/unmount. If a test leaves it mounted and open without
  // unmounting, the listener leaks onto `window` and fires in a *later*
  // test's Escape dispatch, mutating a defunct instance's already-torn-down
  // reactive state — hence unmounting every wrapper here, not just clearing
  // document.body.
  let activeWrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.body.innerHTML = "";
    vi.mocked(api.settings.store).mockReset();
    vi.mocked(api.settings.store).mockResolvedValue({
      message: "ok",
      settings: { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() }
    });
    vi.mocked(api.meta.version).mockReset();
    vi.mocked(api.meta.version).mockResolvedValue({ version: "9.9.9" });
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
    document.body.innerHTML = "";
  });

  function openModal() {
    const ui = useUiStore();
    const wrapper = mount(SettingsModal);
    activeWrapper = wrapper;
    ui.settingsModalOpen = true;
    return wrapper;
  }

  it("does not close on a backdrop click — only Cancel or Done do", async () => {
    openModal();
    await nextTick();
    const ui = useUiStore();
    const body = new DOMWrapper(document.body);

    await body.find(".base-modal-backdrop").trigger("click");
    expect(ui.settingsModalOpen).toBe(true);
  });

  it("regression: Cancel reverts a theme change made while the modal was open", async () => {
    const settings = useSettingsStore();
    expect(settings.theme).toBe("dark");

    openModal();
    await nextTick();
    const body = new DOMWrapper(document.body);

    const lightBtn = body.findAll(".seg-btn").find((b) => b.text() === "Light")!;
    await lightBtn.trigger("click");
    expect(settings.theme).toBe("light"); // live preview applied

    const cancelBtn = body.findAll("button").find((b) => b.text() === "Cancel")!;
    await cancelBtn.trigger("click");

    expect(settings.theme).toBe("dark"); // reverted
    const ui = useUiStore();
    expect(ui.settingsModalOpen).toBe(false);
  });

  it("Escape reverts the same way Cancel does", async () => {
    const settings = useSettingsStore();
    openModal();
    await nextTick();
    const body = new DOMWrapper(document.body);

    const lightBtn = body.findAll(".seg-btn").find((b) => b.text() === "Light")!;
    await lightBtn.trigger("click");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();

    expect(settings.theme).toBe("dark");
    const ui = useUiStore();
    expect(ui.settingsModalOpen).toBe(false);
  });

  it("Done (guest) closes and reports a local-only save without calling the API", async () => {
    openModal();
    await nextTick();
    const toast = useToastStore();
    const body = new DOMWrapper(document.body);

    const doneBtn = body.findAll("button").find((b) => b.text() === "Done")!;
    await doneBtn.trigger("click");
    await nextTick();
    await Promise.resolve(); // let the async handler's flushPush() resolve

    expect(api.settings.store).not.toHaveBeenCalled();
    expect(toast.toasts).toHaveLength(1);
    expect(toast.toasts[0]!.kind).toBe("success");
    expect(toast.toasts[0]!.message).toBe("Settings saved on this device");

    const ui = useUiStore();
    expect(ui.settingsModalOpen).toBe(false);
  });

  it("Done (logged in) awaits the server push and reports success", async () => {
    loginAs();
    openModal();
    await nextTick();
    const toast = useToastStore();
    const body = new DOMWrapper(document.body);

    const doneBtn = body.findAll("button").find((b) => b.text() === "Done")!;
    await doneBtn.trigger("click");
    await nextTick();
    await Promise.resolve();

    expect(api.settings.store).toHaveBeenCalledTimes(1);
    expect(toast.toasts[0]!.message).toBe("Settings saved");
  });

  it("regression: Escape is ignored while a Done-triggered save is in flight", async () => {
    loginAs();
    let resolveStore!: (v: { message: string; settings: typeof DEFAULT_SETTINGS & { updatedAt: string } }) => void;
    vi.mocked(api.settings.store).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStore = resolve;
      })
    );

    const settings = useSettingsStore();
    openModal();
    await nextTick();
    const body = new DOMWrapper(document.body);

    const lightBtn = body.findAll(".seg-btn").find((b) => b.text() === "Light")!;
    await lightBtn.trigger("click");

    const doneBtn = body.findAll("button").find((b) => b.text() === "Done")!;
    await doneBtn.trigger("click"); // starts the (still-pending) save

    // Escape arrives while the request is in flight — must not revert the
    // theme or close the modal out from under the pending save.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await nextTick();
    expect(settings.theme).toBe("light");
    const ui = useUiStore();
    expect(ui.settingsModalOpen).toBe(true);

    resolveStore({ message: "ok", settings: { ...DEFAULT_SETTINGS, updatedAt: new Date().toISOString() } });
    await flushPromises();

    expect(settings.theme).toBe("light"); // the save's own value, untouched
    expect(ui.settingsModalOpen).toBe(false); // Done's own close still runs
  });

  it("Done (logged in, server error) reports failure but still closes", async () => {
    loginAs();
    vi.mocked(api.settings.store).mockRejectedValueOnce(new Error("network down"));
    openModal();
    await nextTick();
    const toast = useToastStore();
    const body = new DOMWrapper(document.body);

    const doneBtn = body.findAll("button").find((b) => b.text() === "Done")!;
    await doneBtn.trigger("click");
    await nextTick();
    await Promise.resolve();

    expect(toast.toasts[0]!.kind).toBe("error");
    const ui = useUiStore();
    expect(ui.settingsModalOpen).toBe(false);
  });

  describe("version footer", () => {
    it("shows the frontend version immediately and the API version once fetched", async () => {
      openModal();
      await nextTick();
      await flushPromises();
      const body = new DOMWrapper(document.body);

      const line = body.find(".version-line").text();
      expect(line).toContain("9.9.9"); // mocked api.meta.version() resolution
      expect(line).toMatch(/Frontend v\d+\.\d+\.\d+/); // __APP_VERSION__, whatever it is
    });

    it("falls back to an em dash for the API half if the fetch fails, frontend half still shown", async () => {
      vi.mocked(api.meta.version).mockRejectedValueOnce(new Error("network down"));
      openModal();
      await nextTick();
      await flushPromises();
      const body = new DOMWrapper(document.body);

      const line = body.find(".version-line").text();
      expect(line).toContain("API v—");
      expect(line).toMatch(/Frontend v\d+\.\d+\.\d+/);
    });

    it("only fetches once across repeated open/close cycles", async () => {
      const wrapper = openModal();
      await nextTick();
      await flushPromises();
      const ui = useUiStore();

      ui.settingsModalOpen = false;
      await nextTick();
      ui.settingsModalOpen = true;
      await nextTick();
      await flushPromises();

      expect(api.meta.version).toHaveBeenCalledTimes(1);
      wrapper.unmount();
      activeWrapper = null;
    });

    it("regression: a failed fetch retries on the next open instead of sticking on em-dash forever", async () => {
      // Without the fix, versionFetched latched to true even on failure, so
      // a transient API outage (mid-deploy, a network blip) permanently
      // stuck the footer on "API v—" for the rest of the session even after
      // the API recovered.
      vi.mocked(api.meta.version).mockRejectedValueOnce(new Error("network down"));
      const wrapper = openModal();
      await nextTick();
      await flushPromises();
      const ui = useUiStore();

      let body = new DOMWrapper(document.body);
      expect(body.find(".version-line").text()).toContain("API v—");

      ui.settingsModalOpen = false;
      await nextTick();
      ui.settingsModalOpen = true;
      await nextTick();
      await flushPromises();

      expect(api.meta.version).toHaveBeenCalledTimes(2);
      body = new DOMWrapper(document.body);
      expect(body.find(".version-line").text()).toContain("9.9.9"); // the (now-default) successful mock

      wrapper.unmount();
      activeWrapper = null;
    });
  });
});
