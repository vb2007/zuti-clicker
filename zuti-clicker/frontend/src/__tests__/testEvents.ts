import { nextTick } from "vue";

/**
 * Dispatches a real DOM event on `element`, patched so `isTrusted` reads
 * `true` — @vue/test-utils' own `trigger()` constructs and dispatches
 * internally with no way to intercept the event first, and every
 * programmatically-constructed event is `isTrusted: false` per spec (that IS
 * the signal the anti-cheat system's `isTrusted` gate checks — see
 * ClickerCircle.vue/UnitCard.vue/UpgradeTile.vue/PrestigeConfirmModal.vue).
 * Tests of ordinary (non-anti-cheat) interaction use this so they keep
 * simulating what a real click looks like; a test of the gate ITSELF
 * dispatches an explicitly untrusted event instead (`wrapper.trigger(...)`,
 * or `dispatchTrusted` with `trusted: false`, work equally for that).
 */
export async function dispatchTrusted(
  element: Element,
  type: string,
  init: PointerEventInit | MouseEventInit = {},
  trusted = true
): Promise<void> {
  const EventCtor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
  const event = new EventCtor(type, { bubbles: true, cancelable: true, ...init });
  if (trusted) {
    Object.defineProperty(event, "isTrusted", { value: true, configurable: true });
  }
  element.dispatchEvent(event);
  await nextTick();
}
