import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper, flushPromises } from "@vue/test-utils";
import FirstSaveRejectedModal from "@/components/modals/FirstSaveRejectedModal.vue";
import { useSaveStore } from "@/stores/saveStore";
import { i18n } from "@/i18n";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      save: { load: vi.fn(), store: vi.fn(), reset: vi.fn() },
      settings: { load: vi.fn(), store: vi.fn() }
    }
  };
});

// Renders via <Teleport to="body"> (BaseModal) — see CLAUDE.md's Teleport
// testing note.
const body = () => new DOMWrapper(document.body);

describe("FirstSaveRejectedModal", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function shown() {
    const save = useSaveStore();
    save.carryOverRejected = true;
    mount(FirstSaveRejectedModal, { attachTo: document.body });
    await nextTick();
    return save;
  }

  it("is hidden until the account's first save is refused", () => {
    mount(FirstSaveRejectedModal, { attachTo: document.body });
    expect(body().find("[role='alertdialog']").exists()).toBe(false);
  });

  it("explains what happened and offers both ways out", async () => {
    await shown();
    const dialog = body().find("[role='alertdialog']");
    expect(dialog.text()).toContain(i18n.global.t("save.firstSaveRejected.title"));
    expect(dialog.text()).toContain(i18n.global.t("save.firstSaveRejected.body"));
    const buttons = dialog.findAll("button").map((b) => b.text());
    expect(buttons).toEqual([
      i18n.global.t("save.firstSaveRejected.keepBtn"),
      i18n.global.t("save.firstSaveRejected.freshBtn")
    ]);
  });

  it("can't be dismissed: Escape leaves it up, since saving is held until a choice", async () => {
    const save = await shown();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await nextTick();
    expect(save.carryOverRejected).toBe(true);
    expect(body().find("[role='alertdialog']").exists()).toBe(true);
  });

  it("keep playing as a guest logs out keeping the progress", async () => {
    const save = await shown();
    const logout = vi.spyOn(save, "logout").mockResolvedValue(true);
    await body().findAll("[role='alertdialog'] button")[0]!.trigger("click");
    await flushPromises();
    expect(logout).toHaveBeenCalledWith({ keepProgress: true });
  });

  it("start fresh resets the account through the store", async () => {
    const save = await shown();
    const fresh = vi.spyOn(save, "startAccountFresh").mockResolvedValue();
    await body().findAll("[role='alertdialog'] button")[1]!.trigger("click");
    await flushPromises();
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
