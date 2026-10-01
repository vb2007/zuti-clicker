import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { api, ApiError, isStaleSaveError, SAVE_STALE_CODE } from "@/lib/api";
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

describe("lib/api — upgrader spin and stale-save detection", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("api.upgrader.spin POSTs exactly { stake, multiplier } to /upgrader/spin", async () => {
    const result = {
      message: "Spin settled.",
      won: false,
      rollPpm: 900_000,
      winPpm: 450_000,
      payout: 200,
      phdCount: 400,
      upgraderSeq: 1,
      consolation: { boosterId: "frenzy", remainingMs: 12_000 }
    };
    const fetchMock = stubFetch(200, result);

    await expect(api.upgrader.spin(100, 2)).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/upgrader\/spin$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ stake: 100, multiplier: 2 });
  });

  it("a 409 keeps the body on the thrown ApiError (the real balance rides along)", async () => {
    stubFetch(409, { error: "You do not have that many PhDs to stake.", phdCount: 40 });
    const err = await api.upgrader.spin(100, 2).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect(((err as ApiError).body as { phdCount: number }).phdCount).toBe(40);
  });

  // A stalled request would otherwise hold purchases and prestige refused (the
  // spin-pending freeze) for the browser's own multi-minute timeout.
  it("regression: the spin and the save carry a timeout signal; unrelated calls don't", async () => {
    const fetchMock = stubFetch(200, { message: "ok" });
    await api.upgrader.spin(10, 2).catch(() => {});
    await api.save.store({ tokens: 0, totalTokensEarned: 0, totalClicks: 0, elapsedSeconds: 0, units: [] }).catch(() => {});
    await api.save.load().catch(() => {});

    const signals = fetchMock.mock.calls.map((c) => (c[1] as RequestInit).signal);
    expect(signals[0]).toBeInstanceOf(AbortSignal); // spin
    expect(signals[1]).toBeInstanceOf(AbortSignal); // save
    expect(signals[2]).toBeUndefined(); // load: unchanged
  });

  it("a 403 from the spin goes through the shared anti-cheat interceptor like every other endpoint", async () => {
    stubFetch(403, { error: "restricted", restrictedUntil: null, strikeCount: 1 });
    const store = useAntiCheatStore();
    await expect(api.upgrader.spin(100, 2)).rejects.toThrow(ApiError);
    expect(store.isRestricted).toBe(true);
  });

  it("isStaleSaveError tells a STALE 409 from the envelope's IMPLAUSIBLE 409 by code, not by text", () => {
    expect(isStaleSaveError(new ApiError(409, "anything", { code: SAVE_STALE_CODE }))).toBe(true);
    // The envelope's rejection: same status, no code.
    expect(isStaleSaveError(new ApiError(409, "could not be verified", {}))).toBe(false);
    expect(isStaleSaveError(new ApiError(409, "x", undefined))).toBe(false);
    // Right code, wrong status — never a stale save.
    expect(isStaleSaveError(new ApiError(400, "x", { code: SAVE_STALE_CODE }))).toBe(false);
    expect(isStaleSaveError(new Error("network"))).toBe(false);
    expect(isStaleSaveError(null)).toBe(false);
  });
});
