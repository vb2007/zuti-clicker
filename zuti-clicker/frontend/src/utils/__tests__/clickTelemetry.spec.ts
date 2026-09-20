import { describe, it, expect } from "vitest";
import {
  bucketIndexForIntervalMs,
  buildHistogram,
  computeMaxRunLength,
  countWithinWindow,
  buildDigest
} from "@/utils/clickTelemetry";
import { HISTOGRAM_BUCKET_COUNT } from "@/utils/antiCheatConstants";

describe("bucketIndexForIntervalMs", () => {
  it("clamps very fast intervals to bucket 0", () => {
    expect(bucketIndexForIntervalMs(0)).toBe(0);
    expect(bucketIndexForIntervalMs(-5)).toBe(0);
  });

  it("puts anything at or beyond the max into the overflow (last) bucket", () => {
    expect(bucketIndexForIntervalMs(3000)).toBe(HISTOGRAM_BUCKET_COUNT - 1);
    expect(bucketIndexForIntervalMs(10_000)).toBe(HISTOGRAM_BUCKET_COUNT - 1);
    expect(bucketIndexForIntervalMs(Infinity)).toBe(HISTOGRAM_BUCKET_COUNT - 1);
  });

  it("is monotonically non-decreasing as the interval grows", () => {
    let lastIndex = 0;
    for (let ms = 15; ms < 3000; ms += 10) {
      const idx = bucketIndexForIntervalMs(ms);
      expect(idx).toBeGreaterThanOrEqual(lastIndex);
      lastIndex = idx;
    }
  });
});

describe("buildHistogram", () => {
  it("sums to the number of intervals given", () => {
    const intervals = [50, 55, 60, 200, 3500];
    const buckets = buildHistogram(intervals);
    expect(buckets).toHaveLength(HISTOGRAM_BUCKET_COUNT);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(intervals.length);
  });

  it("returns an all-zero histogram for no intervals", () => {
    const buckets = buildHistogram([]);
    expect(buckets.every((n) => n === 0)).toBe(true);
  });
});

describe("computeMaxRunLength", () => {
  it("is 0 for no intervals", () => {
    expect(computeMaxRunLength([])).toBe(0);
  });

  it("finds a long run of near-identical intervals (autoclicker-like)", () => {
    const intervals = new Array(50).fill(50) as number[];
    expect(computeMaxRunLength(intervals)).toBe(50);
  });

  it("breaks the run on a real outlier, as human variance would", () => {
    const intervals = [...new Array(10).fill(50), 400, ...new Array(10).fill(50)];
    expect(computeMaxRunLength(intervals)).toBe(10);
  });

  it("naturally-varying human-like intervals never form a long run", () => {
    const intervals = [120, 180, 90, 250, 140, 300, 100, 210, 160, 95, 275, 130];
    expect(computeMaxRunLength(intervals)).toBeLessThan(4);
  });
});

describe("countWithinWindow", () => {
  it("counts only timestamps within the trailing window", () => {
    const timestamps = [0, 100, 500, 900, 950];
    // now=1000, windowMs=500 -> window is [500, 1000]; 500, 900, 950 qualify.
    expect(countWithinWindow(timestamps, 1000, 500)).toBe(3);
  });

  it("returns 0 for an empty list", () => {
    expect(countWithinWindow([], 1000, 500)).toBe(0);
  });
});

describe("buildDigest", () => {
  it("produces a digest whose bucket sum matches clicks - 1", () => {
    const timestamps = [0, 100, 220, 340, 470];
    const digest = buildDigest({
      windowMs: 60_000,
      clickTimestamps: timestamps,
      purchases: 2,
      untrustedClicks: 0,
      hiddenClicks: 0,
      droppedClicks: 0,
      integrityFlags: [],
      weakSignals: [],
      methodCounts: { primary: 5, secondary: 0, keyboard: 0 }
    });
    expect(digest.clicks).toBe(5);
    expect(digest.buckets.reduce((a, b) => a + b, 0)).toBe(4);
    expect(digest.purchases).toBe(2);
  });

  it("carries counters, flags, and methodCounts through unchanged", () => {
    const digest = buildDigest({
      windowMs: 60_000,
      clickTimestamps: [0],
      purchases: 0,
      untrustedClicks: 3,
      hiddenClicks: 1,
      droppedClicks: 2,
      integrityFlags: ["honeypotTouched"],
      weakSignals: ["frozenPressure"],
      methodCounts: { primary: 0, secondary: 1, keyboard: 0 }
    });
    expect(digest.untrustedClicks).toBe(3);
    expect(digest.hiddenClicks).toBe(1);
    expect(digest.droppedClicks).toBe(2);
    expect(digest.integrityFlags).toEqual(["honeypotTouched"]);
    expect(digest.weakSignals).toEqual(["frozenPressure"]);
    expect(digest.methodCounts).toEqual({ primary: 0, secondary: 1, keyboard: 0 });
  });
});
