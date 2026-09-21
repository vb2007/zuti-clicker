import { describe, it, expect } from "@jest/globals";
import {
  evaluateDigest,
  bucketIndexForIntervalMs,
  type AntiCheatDigest
} from "../services/antiCheat.js";
import { HISTOGRAM_BUCKET_COUNT, ENVELOPE_MAX_CPS, MAX_DIGEST_WINDOW_MS } from "../constants/antiCheat.js";

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
    weakSignals: [],
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
    // Unlike a structurally malformed body, this IS real evidence (a
    // well-formed digest lying about its own numbers) — scoreable, just
    // never decisive on the first report (see strikeLadder.test.ts).
    expect(verdict.scoreable).toBe(true);
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

  it("treats a malformed digest (wrong bucket count) as unscoreable, not evidence of tampering", () => {
    // Regression: this used to be `consistent: false` (the same bucket as
    // bucket_sum_mismatch/rate_exceeds_envelope, real evidence), which made
    // it decisive on the very first report — but a structurally malformed
    // body is far more likely to be a client bug or a stale build (this
    // project has hit exactly that four times in production) than a real
    // forgery, which would send a well-formed shape.
    const verdict = evaluateDigest(baseDigest({ buckets: [1, 2, 3] }));
    expect(verdict.scoreable).toBe(false);
    expect(verdict.unscoreableReason).toBe("malformed_digest");
    expect(verdict.flagged).toBe(false);
  });

  // Regression, real production incident ("banned for opening the prestige
  // modal for a few seconds" on iOS/WebKit): a window the browser's own
  // timer was suspended through — backgrounded tab, locked screen, laptop
  // lid close — reports however long the suspension lasted as windowMs,
  // which carries no real timing information (clicks is typically 0). This
  // must never be treated as tampering evidence, only as unscoreable.
  it("treats an oversized windowMs (a browser-suspended window) as unscoreable, not malformed or inconsistent", () => {
    const verdict = evaluateDigest(baseDigest({ windowMs: MAX_DIGEST_WINDOW_MS + 1, clicks: 0 }));
    expect(verdict.scoreable).toBe(false);
    expect(verdict.unscoreableReason).toBe("window_out_of_range");
    expect(verdict.flagged).toBe(false);
  });

  it("still scores a within-range windowMs normally", () => {
    const verdict = evaluateDigest(baseDigest({ windowMs: MAX_DIGEST_WINDOW_MS }));
    expect(verdict.scoreable).toBe(true);
    expect(verdict.consistent).toBe(true);
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

describe("evaluateDigest — weak (pointer-physics) signals are corroborating, not decisive", () => {
  it("a weak signal alone, with nothing else, does not flag", () => {
    const verdict = evaluateDigest(baseDigest({ weakSignals: ["frozenPressure"] }));
    expect(verdict.consistent).toBe(true);
    expect(verdict.flagged).toBe(false);
  });

  it("a weak signal combined with a real statistical signal can push a borderline case over the flag threshold", () => {
    // maxRunLength alone hits RUN_LENGTH_THRESHOLD (score 2, 1 distinct
    // signal) — below both the score AND distinct-signal-count thresholds,
    // so it doesn't flag by itself. One corroborating weak signal (score 1,
    // a 2nd distinct signal) is enough to cross both thresholds.
    const withoutWeak = evaluateDigest(baseDigest({ clicks: 1, maxRunLength: 30 }));
    expect(withoutWeak.consistent).toBe(true);
    expect(withoutWeak.flagged).toBe(false);

    const withWeak = evaluateDigest(
      baseDigest({ clicks: 1, maxRunLength: 30, weakSignals: ["frozenPressure"] })
    );
    expect(withWeak.flagged).toBe(true);
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

// A single input method (one mouse button, or one key) sustaining a high
// rate has a much tighter human ceiling than the aggregate rate does — see
// SINGLE_METHOD_MAX_CPS's own comment for the research this is based on. A
// casual auto-clicker binds to exactly one method (commonly right-click),
// unlike a legitimate multi-handed/multi-device session.
describe("evaluateDigest — single-input-method signal", () => {
  function narrowDigest(overrides: Partial<AntiCheatDigest> = {}): AntiCheatDigest {
    // 1400 clicks over 60s ≈ 23.3 cps — comfortably over SINGLE_METHOD_MAX_CPS
    // (20) if attributed to one method alone.
    const buckets = emptyBuckets();
    const idx = bucketIndexForIntervalMs(43);
    buckets[idx] = 1399;
    return baseDigest({ clicks: 1400, windowMs: 60_000, buckets, maxRunLength: 1399, ...overrides });
  }

  it("flags singleMethodExceedsHumanLimit when effectively all clicks come from one method", () => {
    const verdict = evaluateDigest(
      narrowDigest({
        methodCounts: { primary: 0, secondary: 1400, enter: 0, space: 0, touch: 0, other: 0 }
      })
    );
    expect(verdict.consistent).toBe(true);
    expect(verdict.signals).toContain("singleMethodExceedsHumanLimit");
  });

  it("does not flag it when the same aggregate rate is split across multiple methods", () => {
    const verdict = evaluateDigest(
      narrowDigest({
        methodCounts: { primary: 700, secondary: 700, enter: 0, space: 0, touch: 0, other: 0 }
      })
    );
    expect(verdict.signals).not.toContain("singleMethodExceedsHumanLimit");
  });

  // touch has no researched human-rate ceiling the way mouse/keyboard do
  // (SINGLE_METHOD_MAX_CPS's own comment cites mouse-clicking records), and
  // the client has no pointerType check that would let a mobile player be
  // anything BUT ~100% touch concentration — applying this cap to touch
  // would flag ordinary two-thumb tapping. `dominant` is computed over
  // primary/secondary/enter/space only, so touch never becomes it.
  it("never flags a touch-dominant window, however high the touch-only rate", () => {
    const verdict = evaluateDigest(
      narrowDigest({
        methodCounts: { primary: 0, secondary: 0, enter: 0, space: 0, touch: 1400, other: 0 }
      })
    );
    expect(verdict.consistent).toBe(true);
    expect(verdict.signals).not.toContain("singleMethodExceedsHumanLimit");
  });

  // touch still counts toward methodTotal (the denominator) even though it
  // can never itself be `dominant` — a real mixed mouse+touch session must
  // still dilute concentration correctly rather than touch clicks simply
  // vanishing from the count.
  it("touch clicks still dilute concentration for a genuinely mixed session", () => {
    const verdict = evaluateDigest(
      narrowDigest({
        methodCounts: { primary: 700, secondary: 0, enter: 0, space: 0, touch: 700, other: 0 }
      })
    );
    expect(verdict.signals).not.toContain("singleMethodExceedsHumanLimit");
  });

  it("does not flag it when methodCounts is omitted (an older client not reporting it yet)", () => {
    const verdict = evaluateDigest(narrowDigest());
    expect(verdict.consistent).toBe(true); // never rejected for lacking it
    expect(verdict.signals).not.toContain("singleMethodExceedsHumanLimit");
  });

  // Regression (found live, post-deploy): a malformed-but-PRESENT
  // methodCounts (e.g. a stale cached client's old {primary, secondary,
  // keyboard} shape from before enter/space were split out) used to make
  // the WHOLE digest inconsistent (malformed_digest) — not just skip this
  // one signal, reject everything, including signals that have nothing to
  // do with methodCounts at all. sanitizeMethodCounts is now KEY-WISE
  // tolerant (see its own comment) rather than all-or-nothing, so this
  // stale shape's recognized keys (primary/secondary) now correctly
  // contribute to the signal too — only the unrecognized "keyboard" key is
  // dropped (enter/space default to 0, an undercount, never an overcount).
  // The cast below simulates exactly what a real stale client's JSON
  // produces, which TypeScript would otherwise never let this file
  // construct as a valid AntiCheatDigest.
  it("regression: a malformed (not just absent) methodCounts never invalidates the whole digest", () => {
    const staleShape = { primary: 0, secondary: 1400, keyboard: 0 } as unknown as NonNullable<
      AntiCheatDigest["methodCounts"]
    >;
    const verdict = evaluateDigest(narrowDigest({ methodCounts: staleShape }));
    expect(verdict.consistent).toBe(true); // NOT "malformed_digest"
    expect(verdict.signals).toContain("singleMethodExceedsHumanLimit"); // recognized keys still score
    expect(verdict.signals).toContain("metronome"); // every OTHER signal still evaluates normally
  });

  // A value that isn't even an object at all (not just a differently-shaped
  // one) is the one case sanitizeMethodCounts truly can't do anything
  // with — still only skips this one signal, never rejects the digest.
  it("a methodCounts value that isn't even an object is ignored, not rejected", () => {
    const verdict = evaluateDigest(
      narrowDigest({ methodCounts: "not-an-object" as unknown as NonNullable<AntiCheatDigest["methodCounts"]> })
    );
    expect(verdict.consistent).toBe(true);
    expect(verdict.signals).not.toContain("singleMethodExceedsHumanLimit");
    expect(verdict.signals).toContain("metronome");
  });

  it("does not flag a single method held under the human ceiling", () => {
    const buckets = emptyBuckets();
    const idx = bucketIndexForIntervalMs(100); // 10 cps flat
    buckets[idx] = 599;
    const verdict = evaluateDigest(
      baseDigest({
        clicks: 600,
        windowMs: 60_000,
        buckets,
        maxRunLength: 599,
        methodCounts: { primary: 0, secondary: 600, enter: 0, space: 0, touch: 0, other: 0 }
      })
    );
    expect(verdict.signals).not.toContain("singleMethodExceedsHumanLimit");
  });
});
