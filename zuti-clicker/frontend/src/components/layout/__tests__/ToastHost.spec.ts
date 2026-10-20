import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { mount, DOMWrapper } from "@vue/test-utils";
import ToastHost from "@/components/layout/ToastHost.vue";
import { useToastStore } from "@/stores/toastStore";

// Renders via <Teleport to="body"> — see CLAUDE.md's Teleport testing note.
const body = () => new DOMWrapper(document.body);

describe("ToastHost", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("a toast without an action has no action button and goes after 4 s", async () => {
    mount(ToastHost);
    useToastStore().push("success", "Saved");
    await nextTick();
    expect(body().find(".toast-item").text()).toContain("Saved");
    expect(body().find(".toast-action").exists()).toBe(false);
    vi.advanceTimersByTime(4000);
    expect(useToastStore().toasts).toHaveLength(0);
  });

  it("an action button runs its action and dismisses the toast; it stays up longer", async () => {
    mount(ToastHost);
    const run = vi.fn();
    const toast = useToastStore();
    toast.push("info", "Your thesis is ready", { label: "Log in", run });
    await nextTick();

    vi.advanceTimersByTime(4000);
    expect(toast.toasts).toHaveLength(1);

    const button = body().find(".toast-action");
    expect(button.text()).toBe("Log in");
    await button.trigger("click");
    expect(run).toHaveBeenCalledTimes(1);
    expect(toast.toasts).toHaveLength(0);
  });
});
