import { describe, it, expect, afterEach } from "vitest";
import { checkNativeIntegrity, createHoneypotTracker, HONEYPOT_ELEMENT_ID } from "@/utils/integrityChecks";

// Note: happy-dom's EventTarget.prototype.dispatchEvent/HTMLElement.prototype.click
// are JS reimplementations (their toString is real source, not
// "[native code]") — a test-environment artifact, not something a real
// browser exhibits. Function.prototype.bind/setInterval/Date.now ARE real
// Node/V8 natives even under happy-dom, so those are what's exercised here;
// the other two checks run the identical logic against the real thing in
// any actual browser.
describe("checkNativeIntegrity", () => {
  it("does not flag an untouched native", () => {
    expect(checkNativeIntegrity()).not.toContain("patched:bind");
  });

  it("flags a monkey-patched native", () => {
    const original = Function.prototype.bind;
    // A trivial, deliberately non-native replacement — detection only
    // cares that toString() no longer reports "[native code]".
    Function.prototype.bind = function fakeBind(thisArg: unknown) {
      return original.call(this, thisArg);
    } as typeof Function.prototype.bind;
    try {
      expect(checkNativeIntegrity()).toContain("patched:bind");
    } finally {
      Function.prototype.bind = original;
    }
  });
});

describe("createHoneypotTracker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete (window as unknown as Record<string, unknown>)["__zutiGame"];
  });

  it("installs an off-screen, aria-hidden, non-tabbable trap element", () => {
    const tracker = createHoneypotTracker();
    tracker.install();
    const trap = document.getElementById(HONEYPOT_ELEMENT_ID);
    expect(trap).not.toBeNull();
    expect(trap?.getAttribute("aria-hidden")).toBe("true");
    expect(trap?.tabIndex).toBe(-1);
    tracker.uninstall();
  });

  it("is idempotent — installing twice does not create two trap elements", () => {
    const tracker = createHoneypotTracker();
    tracker.install();
    tracker.install();
    expect(document.querySelectorAll(`#${HONEYPOT_ELEMENT_ID}`)).toHaveLength(1);
    tracker.uninstall();
  });

  it("records a flag when the trap element is clicked", () => {
    const tracker = createHoneypotTracker();
    tracker.install();
    document.getElementById(HONEYPOT_ELEMENT_ID)?.dispatchEvent(new MouseEvent("click"));
    expect(tracker.drainFlags()).toEqual(["honeypot:clickTrap"]);
    tracker.uninstall();
  });

  it("records a flag when the exposed global trap function is called", () => {
    const tracker = createHoneypotTracker();
    tracker.install();
    const g = window as unknown as { __zutiGame: { addTokens: (n: number) => void } };
    g.__zutiGame.addTokens(999);
    expect(tracker.drainFlags()).toEqual(["honeypot:addTokens"]);
    tracker.uninstall();
  });

  it("drainFlags clears accumulated flags", () => {
    const tracker = createHoneypotTracker();
    tracker.install();
    document.getElementById(HONEYPOT_ELEMENT_ID)?.dispatchEvent(new MouseEvent("click"));
    tracker.drainFlags();
    expect(tracker.drainFlags()).toEqual([]);
    tracker.uninstall();
  });

});
