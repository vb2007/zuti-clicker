import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { resolveAntiCheatMode } from "../constants/antiCheat.js";

// Pure unit test — resolveAntiCheatMode takes its env inputs explicitly
// rather than reading process.env itself, specifically so this doesn't need
// module-reload tricks to exercise every combination.
describe("resolveAntiCheatMode", () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("defaults to enforce when ANTICHEAT_MODE is unset", () => {
    expect(resolveAntiCheatMode({})).toBe("enforce");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("defaults to enforce when ANTICHEAT_MODE is an empty string", () => {
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: "" })).toBe("enforce");
  });

  it.each(["enforce", "monitor", "off"] as const)("honors an explicit %s", (mode) => {
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: mode })).toBe(mode);
  });

  it("defaults to enforce and warns on an unrecognized value", () => {
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: "bogus" })).toBe("enforce");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("bogus");
  });

  it("forces enforce under NODE_ENV=production even when monitor was requested", () => {
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: "monitor", NODE_ENV: "production" })).toBe(
      "enforce"
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("production");
  });

  it("forces enforce under NODE_ENV=production even when off was requested", () => {
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: "off", NODE_ENV: "production" })).toBe(
      "enforce"
    );
  });

  it("does not warn under NODE_ENV=production when enforce was already requested", () => {
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: "enforce", NODE_ENV: "production" })).toBe(
      "enforce"
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn under NODE_ENV=production when nothing was requested (default is already enforce)", () => {
    expect(resolveAntiCheatMode({ NODE_ENV: "production" })).toBe("enforce");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("honors monitor/off freely outside production", () => {
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: "monitor", NODE_ENV: "development" })).toBe(
      "monitor"
    );
    expect(resolveAntiCheatMode({ ANTICHEAT_MODE: "off", NODE_ENV: "test" })).toBe("off");
  });
});
