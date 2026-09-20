import { describe, it, expect } from "vitest";
import { QUICK_RESET_ENABLED, shouldQuickReset } from "@/utils/featureFlags";

function altX(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { altKey: true, code: "KeyX", repeat: false, ...overrides } as KeyboardEvent;
}

describe("shouldQuickReset", () => {
  it("fires on Alt+X when the flag is enabled", () => {
    expect(shouldQuickReset(altX(), true)).toBe(true);
  });

  it("never fires when the flag is disabled, regardless of the keypress", () => {
    expect(shouldQuickReset(altX(), false)).toBe(false);
  });

  it("ignores a held-key repeat even when enabled", () => {
    expect(shouldQuickReset(altX({ repeat: true }), true)).toBe(false);
  });

  it("requires the Alt modifier", () => {
    expect(shouldQuickReset(altX({ altKey: false }), true)).toBe(false);
  });

  it("requires the X key specifically", () => {
    expect(shouldQuickReset(altX({ code: "KeyZ" }), true)).toBe(false);
  });
});

describe("QUICK_RESET_ENABLED", () => {
  it("is off by default (no VITE_ENABLE_QUICK_RESET set in this test run)", () => {
    expect(QUICK_RESET_ENABLED).toBe(false);
  });
});
