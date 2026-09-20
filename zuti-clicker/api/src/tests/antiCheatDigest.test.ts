import { describe, it, expect } from "@jest/globals";
import {
  evaluateDigest,
  bucketIndexForIntervalMs,
  type AntiCheatDigest
} from "../services/antiCheat.js";
import { HISTOGRAM_BUCKET_COUNT, ENVELOPE_MAX_CPS } from "../constants/antiCheat.js";

// Pure unit tests — no live server or database. This is where the
// statistical scoring itself is proved; the stateful "2 consecutive
// windows" escalation and the HTTP wiring are covered separately once
// database/models/antiCheat.ts and the report endpoint exist.

function emptyBuckets(): number[] {
  return new Array(HISTOGRAM_BUCKET_COUNT).fill(0) as number[];
}

function baseDigest(overrides: Partial<AntiCheatDigest> = {}): AntiCheatDigest {
  return {
    windowMs: 60_000,
    clicks: 0,
    purchases: 0,
    buckets: emptyBuckets(),
    maxRunLength: 0,
    untrustedClicks: 0,
    hiddenClicks: 0,
    droppedClicks: 0,
    integrityFlags: [],
    ...overrides
  };
}

describe("evaluateDigest — consistency", () => {
  it("accepts an idle window (no clicks at all)", () => {
    const verdict = evaluateDigest(baseDigest());
    expect(verdict.consistent).toBe(true);
    expect(verdict.flagged).toBe(false);
  });

  it("rejects a bucket sum that doesn't match the reported click count", () => {
    const buckets = emptyBuckets();
    buckets[5] = 10; // 10 intervals reported, but clicks says only 3 (2 intervals)
    const verdict = evaluateDigest(baseDigest({ clicks: 3, buckets }));
    expect(verdict.consistent).toBe(false);
    expect(verdict.inconsistencyReason).toBe("bucket_sum_mismatch");
  });

  it("rejects a rate beyond the envelope's own hard ceiling", () => {
    const buckets = emptyBuckets();
    const idx = bucketIndexForIntervalMs(50);
    buckets[idx] = 5999;
    const verdict = evaluateDigest(
      baseDigest({ clicks: 6000, windowMs: 60_000, buckets, maxRunLength: 5999 })
    );
    expect(6000 / 60).toBeGreaterThan(ENVELOPE_MAX_CPS); // sanity: this really is over the ceiling
    expect(verdict.consistent).toBe(false);
    expect(verdict.inconsistencyReason).toBe("rate_exceeds_envelope");
  });

  it("rejects a malformed digest (wrong bucket count) without throwing", () => {
    const verdict = evaluateDigest(baseDigest({ buckets: [1, 2, 3] }));
    expect(verdict.consistent).toBe(false);
    expect(verdict.inconsistencyReason).toBe("malformed_digest");
  });
});

describe("evaluateDigest — zero-false-positive signals", () => {
  it("flags immediately on any untrusted (synthetic) click, regardless of everything else", () => {
    const verdict = evaluateDigest(baseDigest({ untrustedClicks: 1 }));
    expect(verdict.flagged).toBe(true);
  });

  it("flags immediately on any integrity flag, regardless of everything else", () => {
    const verdict = evaluateDigest(baseDigest({ integrityFlags: ["honeypotTouched"] }));
    expect(verdict.flagged).toBe(true);
  });
});

describe("evaluateDigest — human-like clicking is never flagged", () => {
  it("a moderate, naturally-spread clicking session is not flagged", () => {
    // ~59 intervals spread across several adjacent buckets with no single
    // bucket dominating and no long metronome run — the shape of a real
    // person clicking at a varying, moderate pace.
    const buckets = emptyBuckets();
    const startIdx = bucketIndexForIntervalMs(120);
    const spread = [2, 5, 10, 15, 12, 8, 4, 2, 1];
    spread.forEach((count, offset) => {
      const idx = startIdx + offset;
      if (idx < buckets.length) buckets[idx] = count;
    });
    const clicks = spread.reduce((a, b) => a + b, 0) + 1;
    const verdict = evaluateDigest(
      baseDigest({ clicks, windowMs: 20_000, buckets, maxRunLength: 4 })
    );
    expect(verdict.consistent).toBe(true);
    expect(verdict.flagged).toBe(false);
  });

  it("a fast two-handed burst with realistic variance and fatigue is not flagged", () => {
    // ~28 CPS sustained for a bit, but spread across multiple buckets and
    // with a short max run — the exact scenario the CPS-alone approach
    // would false-positive on, and which sustainedRate alone (weight 1)
    // cannot flag by itself.
    const buckets = emptyBuckets();
    const startIdx = bucketIndexForIntervalMs(30);
    const spread = [30, 90, 140, 110, 60, 20];
    spread.forEach((count, offset) => {
      const idx = startIdx + offset;
      if (idx < buckets.length) buckets[idx] = count;
    });
    const intervalCount = spread.reduce((a, b) => a + b, 0);
    const clicks = intervalCount + 1;
    const windowMs = (intervalCount / 28) * 1000; // ~28 cps average
    const verdict = evaluateDigest(
      baseDigest({ clicks, windowMs, buckets, maxRunLength: 6 })
    );
    expect(verdict.consistent).toBe(true);
    expect(verdict.flagged).toBe(false);
  });

  it("keyboard-only play (few clicks, no continuous pattern) is not flagged", () => {
    const buckets = emptyBuckets();
    buckets[bucketIndexForIntervalMs(800)] = 1;
    buckets[bucketIndexForIntervalMs(2200)] = 1;
    const verdict = evaluateDigest(baseDigest({ clicks: 3, windowMs: 60_000, buckets, maxRunLength: 1 }));
    expect(verdict.flagged).toBe(false);
  });
});

describe("evaluateDigest — autoclicker patterns are flagged", () => {
  it("flags a flat fixed-interval autoclicker (all intervals in one bucket, long run)", () => {
    const buckets = emptyBuckets();
    const idx = bucketIndexForIntervalMs(50); // 20 cps flat
    buckets[idx] = 99;
    const verdict = evaluateDigest(
      baseDigest({ clicks: 100, windowMs: 5_000, buckets, maxRunLength: 99 })
    );
    expect(verdict.consistent).toBe(true);
    expect(verdict.flagged).toBe(true);
    expect(verdict.signals).toContain("metronome");
    expect(verdict.signals).toContain("narrowSupport");
  });

  it("flags a lightly-jittered autoclicker (narrow spread, no long run, but still unnatural)", () => {
    const buckets = emptyBuckets();
    const idx = bucketIndexForIntervalMs(45);
    // Jitter across 2 adjacent buckets only, evenly split — narrow support
    // and low variance, but the run breaks up so metronome alone can't
    // explain the flag; two OTHER distinct signals must combine instead.
    buckets[idx] = 50;
    buckets[idx + 1] = 50;
    const verdict = evaluateDigest(
      baseDigest({ clicks: 101, windowMs: 5_000, buckets, maxRunLength: 3 })
    );
    expect(verdict.consistent).toBe(true);
    expect(verdict.flagged).toBe(true);
    expect(verdict.signals).not.toContain("metronome");
  });
});
