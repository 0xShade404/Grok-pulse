import type { BacktestTrade, CalibrationBucket, CalibrationSummary } from "./types.js";

/**
 * CLAUDE.md section 34 (Probability Calibration): bucket predicted
 * probabilities into 0.50-0.55 ... 0.80+ and compare against observed
 * (actual) outcome frequency per bucket.
 */

interface CalibrationBucketDefinition {
  label: string;
  min: number;
  /** Exclusive, except for the last bucket (0.80+), which is inclusive of 1.0. */
  max: number;
}

/** The exact bucket boundaries CLAUDE.md section 34 lists. */
export const CALIBRATION_BUCKET_DEFINITIONS: readonly CalibrationBucketDefinition[] = [
  { label: "0.50-0.55", min: 0.5, max: 0.55 },
  { label: "0.55-0.60", min: 0.55, max: 0.6 },
  { label: "0.60-0.65", min: 0.6, max: 0.65 },
  { label: "0.65-0.70", min: 0.65, max: 0.7 },
  { label: "0.70-0.75", min: 0.7, max: 0.75 },
  { label: "0.75-0.80", min: 0.75, max: 0.8 },
  { label: "0.80+", min: 0.8, max: 1 },
];

export interface CalibrationSample {
  predictedProbability: number;
  /** 1 if the chosen side actually won, 0 otherwise. */
  actualOutcome: 0 | 1;
}

/**
 * Map a resolved trade to a calibration sample. `predictedProbability` uses
 * `BacktestTrade.predictedProbability` (already the probability of the
 * CHOSEN side winning, not raw P(YES) -- see that field's doc comment),
 * so every sample naturally falls in [0.5, 1.0], matching CLAUDE.md's
 * bucket range.
 */
export function tradeToCalibrationSample(
  trade: Pick<BacktestTrade, "predictedProbability" | "outcome">,
): CalibrationSample {
  return {
    predictedProbability: trade.predictedProbability,
    actualOutcome: trade.outcome === "WIN" ? 1 : 0,
  };
}

function bucketIndexFor(probability: number): number {
  for (let i = 0; i < CALIBRATION_BUCKET_DEFINITIONS.length; i++) {
    const def = CALIBRATION_BUCKET_DEFINITIONS[i]!;
    const isLastBucket = i === CALIBRATION_BUCKET_DEFINITIONS.length - 1;
    const withinUpperBound = isLastBucket ? probability <= 1 : probability < def.max;
    if (probability >= def.min && withinUpperBound) return i;
  }
  return -1;
}

/**
 * Bucket a set of (predicted probability, actual outcome) samples and
 * compute observed frequency + calibration error per bucket, plus an
 * overall sample-count-weighted mean absolute error (a standard Expected
 * Calibration Error).
 *
 * Handles both edge cases the task calls out explicitly:
 *  - Empty input: every bucket has `sampleCount: 0` and null
 *    averagePredictedProbability/observedFrequency/calibrationError;
 *    `weightedMeanAbsoluteError` is 0 (not NaN).
 *  - Single-bucket-only data: the other six buckets are still present in
 *    `buckets` (all empty), and `weightedMeanAbsoluteError` reduces to
 *    exactly that one bucket's own calibration error, since it is the only
 *    bucket contributing weight.
 *
 * Samples with `predictedProbability < 0.5` fall outside every defined
 * bucket and are counted in `excludedSamples` rather than silently dropped
 * or force-bucketed into a range they don't belong in.
 */
export function computeCalibration(samples: readonly CalibrationSample[]): CalibrationSummary {
  const bucketPredicted: number[][] = CALIBRATION_BUCKET_DEFINITIONS.map(() => []);
  const bucketOutcomes: number[][] = CALIBRATION_BUCKET_DEFINITIONS.map(() => []);
  let excludedSamples = 0;

  for (const sample of samples) {
    const idx = bucketIndexFor(sample.predictedProbability);
    if (idx === -1) {
      excludedSamples++;
      continue;
    }
    bucketPredicted[idx]!.push(sample.predictedProbability);
    bucketOutcomes[idx]!.push(sample.actualOutcome);
  }

  let weightedErrorSum = 0;
  let totalSamples = 0;

  const buckets: CalibrationBucket[] = CALIBRATION_BUCKET_DEFINITIONS.map((def, i) => {
    const predicted = bucketPredicted[i]!;
    const outcomes = bucketOutcomes[i]!;
    const sampleCount = predicted.length;

    if (sampleCount === 0) {
      return {
        label: def.label,
        rangeMin: def.min,
        rangeMax: def.max,
        sampleCount: 0,
        averagePredictedProbability: null,
        observedFrequency: null,
        calibrationError: null,
      };
    }

    const averagePredictedProbability = predicted.reduce((a, b) => a + b, 0) / sampleCount;
    const observedFrequency = outcomes.reduce((a, b) => a + b, 0) / sampleCount;
    const calibrationError = Math.abs(averagePredictedProbability - observedFrequency);

    weightedErrorSum += calibrationError * sampleCount;
    totalSamples += sampleCount;

    return {
      label: def.label,
      rangeMin: def.min,
      rangeMax: def.max,
      sampleCount,
      averagePredictedProbability,
      observedFrequency,
      calibrationError,
    };
  });

  return {
    buckets,
    weightedMeanAbsoluteError: totalSamples > 0 ? weightedErrorSum / totalSamples : 0,
    totalSamples,
    excludedSamples,
  };
}
