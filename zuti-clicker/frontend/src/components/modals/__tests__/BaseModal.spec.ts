import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defineComponent, ref } from "vue";
import { mount, DOMWrapper, type VueWrapper } from "@vue/test-utils";
import BaseModal from "@/components/modals/BaseModal.vue";

// A host component mimics a real call site: an "opener" button that lives
// outside the modal, plus the modal itself, both attached to document.body so
// focus() actually moves document.activeElement (a happy-dom requirement —
// mount() without attachTo renders into a detached, unfocusable tree).
function mountHost(initialOpen = false, opts: { dismissOnBackdrop?: boolean } = {}) {
  const Host = defineComponent({
    components: { BaseModal },
    setup() {
      const open = ref(initialOpen);
      return { open, dismissOnBackdrop: opts.dismissOnBackdrop ?? true };
    },
    template: `
      <div>
        <button id="opener">Open</button>
        <BaseModal
          :open="open"
          title="Test modal"
          :dismiss-on-backdrop="dismissOnBackdrop"
          @close="open = false"
        >
          <button id="first">First</button>
          <button id="second">Second</button>
        </BaseModal>
      </div>
    `
  });
  return mount(Host, { attachTo: document.body });
}

describe("BaseModal", () => {
  let wrapper: VueWrapper | null = null;
  const body = () => new DOMWrapper(document.body);

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("moves focus into the modal's first focusable element on open", async () => {
    wrapper = mountHost(false);
    (wrapper.find("#opener").element as HTMLElement).focus();
    expect(document.activeElement?.id).toBe("opener");

    const vm = wrapper.vm as unknown as { open: boolean };
    vm.open = true;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // let the watcher's own nextTick() resolve

    expect(document.activeElement?.id).toBe("first");
  });

  it("restores focus to the previously-focused element on close", async () => {
    wrapper = mountHost(true);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(document.activeElement?.id).toBe("first");

    const vm = wrapper.vm as unknown as { open: boolean };
    vm.open = false;
    await wrapper.vm.$nextTick();

    // No prior element was focused before this modal opened (it started
    // open), so focus falls back to <body> — this test only pins that the
    // modal's own content is no longer focused after close.
    expect(document.activeElement?.id).not.toBe("first");
  });

  it("restores focus to the actual opener element across an open/close cycle", async () => {
    wrapper = mountHost(false);
    (wrapper.find("#opener").element as HTMLElement).focus();

    const vm = wrapper.vm as unknown as { open: boolean };
    vm.open = true;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(document.activeElement?.id).toBe("first");

    vm.open = false;
    await wrapper.vm.$nextTick();
    expect(document.activeElement?.id).toBe("opener");
  });

  it("Escape emits close", async () => {
    wrapper = mountHost(true);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as { open: boolean };
    expect(vm.open).toBe(false);
  });

  it("Tab wraps from the last focusable back to the first", async () => {
    wrapper = mountHost(true);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const second = body().find("#second").element as HTMLElement;
    second.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    window.dispatchEvent(event);

    expect(document.activeElement?.id).toBe("first");
    expect(event.defaultPrevented).toBe(true);
  });

  it("Shift+Tab wraps from the first focusable back to the last", async () => {
    wrapper = mountHost(true);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const first = body().find("#first").element as HTMLElement;
    first.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(event);

    expect(document.activeElement?.id).toBe("second");
  });

  it("a backdrop click emits close by default", async () => {
    wrapper = mountHost(true);
    await wrapper.vm.$nextTick();

    await body().find(".base-modal-backdrop").trigger("click");

    const vm = wrapper.vm as unknown as { open: boolean };
    expect(vm.open).toBe(false);
  });

  it("dismissOnBackdrop=false suppresses the backdrop click", async () => {
    wrapper = mountHost(true, { dismissOnBackdrop: false });
    await wrapper.vm.$nextTick();

    await body().find(".base-modal-backdrop").trigger("click");

    const vm = wrapper.vm as unknown as { open: boolean };
    expect(vm.open).toBe(true);
  });

  it("wires the title to aria-labelledby", async () => {
    wrapper = mountHost(true);
    await wrapper.vm.$nextTick();

    const dialog = body().find('[role="dialog"]');
    const labelledBy = dialog.attributes("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(body().find(`#${labelledBy}`).text()).toBe("Test modal");
  });

  it("compact tightens the padding via a class, and is off by default", async () => {
    const Host = defineComponent({
      components: { BaseModal },
      props: { compact: { type: Boolean, default: false } },
      template: `<BaseModal :open="true" title="T" :compact="compact"><p>x</p></BaseModal>`
    });
    wrapper = mount(Host, { attachTo: document.body });
    await wrapper.vm.$nextTick();
    expect(body().find(".base-modal").classes()).not.toContain("compact");

    await wrapper.setProps({ compact: true });
    expect(body().find(".base-modal").classes()).toContain("compact");
  });

  describe("closable", () => {
    function mountClosable(props: { closable?: boolean } = {}) {
      const Host = defineComponent({
        components: { BaseModal },
        setup() {
          const open = ref(true);
          return { open, closable: props.closable ?? true };
        },
        template: `
          <BaseModal :open="open" title="T" :closable="closable" @close="open = false">
            <input id="field" />
          </BaseModal>`
      });
      return mount(Host, { attachTo: document.body });
    }

    it("is off by default: no close button", async () => {
      wrapper = mountHost(true);
      await wrapper.vm.$nextTick();
      expect(body().find(".modal-close").exists()).toBe(false);
    });

    it("renders a labelled ✕ that emits close", async () => {
      wrapper = mountClosable();
      await wrapper.vm.$nextTick();

      const close = body().find(".modal-close");
      expect(close.attributes("aria-label")).toBe("Close");
      await close.trigger("click");

      expect((wrapper.vm as unknown as { open: boolean }).open).toBe(false);
    });

    it("renders even without a title (aria-label-only modals like Auth)", async () => {
      const Host = defineComponent({
        components: { BaseModal },
        template: `<BaseModal :open="true" aria-label="x" closable><p>hi</p></BaseModal>`
      });
      wrapper = mount(Host, { attachTo: document.body });
      await wrapper.vm.$nextTick();
      expect(body().find(".modal-close").exists()).toBe(true);
    });

    it("does not steal initial focus: content gets it, not the ✕", async () => {
      wrapper = mountClosable();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();
      expect(document.activeElement?.id).toBe("field");
    });

    it("the ✕ stays inside the Tab focus trap", async () => {
      wrapper = mountClosable();
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      // From the last focusable (the field), Tab wraps to the first (the ✕).
      (body().find("#field").element as HTMLElement).focus();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
      expect(document.activeElement?.className).toContain("modal-close");
    });
  });

  // Regression: every open modal used to listen for Escape on its own, so a
  // stacked pair (confirm over settings) both closed on a single press.
  it("regression: Escape closes only the top-most of two stacked modals", async () => {
    const Host = defineComponent({
      components: { BaseModal },
      setup() {
        return { lower: ref(true), upper: ref(true) };
      },
      template: `
        <div>
          <BaseModal :open="lower" title="Lower" @close="lower = false"><p>l</p></BaseModal>
          <BaseModal :open="upper" title="Upper" @close="upper = false"><p>u</p></BaseModal>
        </div>`
    });
    wrapper = mount(Host, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as unknown as { lower: boolean; upper: boolean };
    expect(vm.upper).toBe(false);
    expect(vm.lower).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(vm.lower).toBe(false);
  });

  it("Back (popstate) closes the modal like Escape does", async () => {
    wrapper = mountHost(true);
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as unknown as { open: boolean }).open).toBe(false);
  });
});
