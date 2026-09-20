import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { api, ApiError } from "@/lib/api";
import { useAntiCheatStore } from "@/stores/antiCheatStore";

// api.ts's shared request() function is the single funnel every endpoint
// goes through — this is where a 403 (exclusively ANTICHEAT.RESTRICTED; see
// api/src/constants/responses.ts, the only 403 this API ever returns) must
// be applied to antiCheatStore regardless of which endpoint returned it, so
// a restricted PUT /save or POST /boosters/claim pops the warning modal
// immediately rather than surfacing as a generic error and waiting for the
// next heartbeat.
describe("lib/api request() — 403 anti-cheat interceptor", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("applies a 403 from ANY endpoint to antiCheatStore before rethrowing", async () => {
    const restrictedUntil = new Date(Date.now() + 900_000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: "This account is temporarily restricted due to suspected automation.",
          restrictedUntil,
          strikeCount: 2
        })
      })
    );

    const store = useAntiCheatStore();
    expect(store.isRestricted).toBe(false);

    await expect(api.boosters.claim()).rejects.toThrow(ApiError);

    expect(store.isRestricted).toBe(true);
    expect(store.strikeCount).toBe(2);
    expect(store.restrictedUntil?.toISOString()).toBe(restrictedUntil);
  });

  it("does not touch antiCheatStore for a non-403 error (e.g. 409 on boosters.claim)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "On cooldown.", nextAvailableInMs: 1000 })
      })
    );

    const store = useAntiCheatStore();
    await expect(api.boosters.claim()).rejects.toThrow(ApiError);
    expect(store.isRestricted).toBe(false);
  });
});
