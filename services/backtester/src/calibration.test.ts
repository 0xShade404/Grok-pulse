import { describe, expect, it } from "vitest";
import { CALIBRATION_BUCKET_DEFINITIONS, computeCalibration, tradeToCalibrationSample } from "./calibration.js";
import type { CalibrationSample } from "./calibration.js";

describe("computeCalibration", () => {
  it("edge case: empty input -- every bucket present but empty, zero weighted error", () => {
    const summary = computeCalibration([]);
    expect(summary.buckets).toHaveLength(CALIBRATION_BUCKET_DEFINITIONS.length);
    for (const bucket of summary.buckets) {
      expect(bucket.sampleCount).toBe(0);
      expect(bucket.averagePredictedProbability).toBeNull();
      expect(bucket.observedFrequency).toBeNull();
      expect(bucket.calibrationError).toBeNull();
    }
    expect(summary.weightedMeanAbsoluteError).toBe(0);
    expect(summary.totalSamples).toBe(0);
    expect(summary.excludedSamples).toBe(0);
  });

  it("edge case: single-bucket-only data -- other buckets stay empty, overall error equals that bucket's own error", () => {
    // All four samples land in 0.70-0.75, predicted avg 0.72, observed 2/4 = 0.5.
    const samples: CalibrationSample[] = [
      { predictedProbability: 0.7, actualOutcome: 1 },
      { predictedProbability: 0.71, actualOutcome: 0 },
      { predictedProbability: 0.73, actualOutcome: 1 },
      { predictedProbability: 0.74, actualOutcome: 0 },
    ];
    const summary = computeCalibration(samples);

    const targetBucket = summary.buckets.find((b) => b.label === "0.70-0.75")!;
    expect(targetBucket.sampleCount).toBe(4);
    expect(targetBucket.averagePredictedProbability).toBeCloseTo((0.7 + 0.71 + 0.73 + 0.74) / 4, 10);
    expect(targetBucket.observedFrequency).toBeCloseTo(0.5, 10);
    expect(targetBucket.calibrationError).toBeCloseTo(
      Math.abs((0.7 + 0.71 + 0.73 + 0.74) / 4 - 0.5),
      10,
    );

    for (const bucket of summary.buckets) {
      if (bucket.label === "0.70-0.75") continue;
      expect(bucket.sampleCount).toBe(0);
    }

    // Overall weighted error is exactly the one non-empty bucket's error,
    // since it is the sole contributor of weight.
    expect(summary.weightedMeanAbsoluteError).toBeCloseTo(targetBucket.calibrationError!, 10);
    expect(summary.totalSamples).toBe(4);
  });

  it("hand-computes a perfectly calibrated bucket (predicted ~= observed => ~0 error)", () => {
    // 10 samples at predicted 0.60, 6 wins (observed 0.6) -- perfectly calibrated.
    const samples: CalibrationSample[] = [
      ...Array.from({ length: 6 }, () => ({ predictedProbability: 0.6, actualOutcome: 1 as const })),
      ...Array.from({ length: 4 }, () => ({ predictedProbability: 0.6, actualOutcome: 0 as const })),
    ];
    const summary = computeCalibration(samples);
    const bucket = summary.buckets.find((b) => b.label === "0.60-0.65")!;
    expect(bucket.averagePredictedProbability).toBeCloseTo(0.6, 10);
    expect(bucket.observedFrequency).toBeCloseTo(0.6, 10);
    expect(bucket.calibrationError).toBeCloseTo(0, 10);
    expect(summary.weightedMeanAbsoluteError).toBeCloseTo(0, 10);
  });

  it("hand-computes a badly miscalibrated bucket", () => {
    // 5 samples predicted 0.90 ("0.80+" bucket), but only 1 actually won (observed 0.2).
    const samples: CalibrationSample[] = [
      { predictedProbability: 0.9, actualOutcome: 1 },
      { predictedProbability: 0.9, actualOutcome: 0 },
      { predictedProbability: 0.9, actualOutcome: 0 },
      { predictedProbability: 0.9, actualOutcome: 0 },
      { predictedProbability: 0.9, actualOutcome: 0 },
    ];
    const summary = computeCalibration(samples);
    const bucket = summary.buckets.find((b) => b.label === "0.80+")!;
    expect(bucket.averagePredictedProbability).toBeCloseTo(0.9, 10);
    expect(bucket.observedFrequency).toBeCloseTo(0.2, 10);
    expect(bucket.calibrationError).toBeCloseTo(0.7, 10);
  });

  it("assigns an exact 0.80 sample to the 0.80+ bucket and an exact 1.0 sample stays in-range", () => {
    const summary = computeCalibration([
      { predictedProbability: 0.8, actualOutcome: 1 },
      { predictedProbability: 1.0, actualOutcome: 1 },
    ]);
    const bucket = summary.buckets.find((b) => b.label === "0.80+")!;
    expect(bucket.sampleCount).toBe(2);
    expect(summary.excludedSamples).toBe(0);
  });

  it("assigns a boundary sample (exactly 0.65) to the upper bucket, not the lower one", () => {
    const summary = computeCalibration([{ predictedProbability: 0.65, actualOutcome: 1 }]);
    expect(summary.buckets.find((b) => b.label === "0.65-0.70")!.sampleCount).toBe(1);
    expect(summary.buckets.find((b) => b.label === "0.60-0.65")!.sampleCount).toBe(0);
  });

  it("excludes out-of-range (< 0.50) samples rather than mis-bucketing them", () => {
    const summary = computeCalibration([
      { predictedProbability: 0.3, actualOutcome: 1 },
      { predictedProbability: 0.6, actualOutcome: 1 },
    ]);
    expect(summary.excludedSamples).toBe(1);
    expect(summary.totalSamples).toBe(1);
    for (const bucket of summary.buckets) {
      expect(bucket.sampleCount).toBeLessThanOrEqual(1);
    }
  });
});

describe("tradeToCalibrationSample", () => {
  it("maps a WIN trade to actualOutcome 1 and a LOSS trade to 0", () => {
    expect(tradeToCalibrationSample({ predictedProbability: 0.7, outcome: "WIN" })).toEqual({
      predictedProbability: 0.7,
      actualOutcome: 1,
    });
    expect(tradeToCalibrationSample({ predictedProbability: 0.7, outcome: "LOSS" })).toEqual({
      predictedProbability: 0.7,
      actualOutcome: 0,
    });
  });
});
