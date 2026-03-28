import { getLiveAngles } from "@/lib/angles";
import type { AnalyzePayload } from "@/lib/analysis-contract";
import type { PoseLandmarkPoint } from "@/lib/pose";

type RepFrame = {
  detectedAt: number;
  landmarks: PoseLandmarkPoint[];
};

type AngleSample = {
  index: number;
  detectedAt: number;
  value: number;
};

function average(values: Array<number | null>) {
  const numericValues = values.filter((value): value is number => value !== null);

  if (numericValues.length === 0) {
    return null;
  }

  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length;
}

function smooth(values: number[]) {
  return values.map((_, index) => {
    const start = Math.max(0, index - 1);
    const end = Math.min(values.length - 1, index + 1);
    const window = values.slice(start, end + 1);
    return window.reduce((sum, item) => sum + item, 0) / window.length;
  });
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function getRepConfidence(amplitude: number, durationMs: number): "high" | "medium" | "low" {
  if (amplitude >= 25 && durationMs >= 800) {
    return "high";
  }

  if (amplitude >= 15 && durationMs >= 500) {
    return "medium";
  }

  return "low";
}

export function summarizeReps(frames: RepFrame[]): AnalyzePayload["repStats"] & {
  reps: AnalyzePayload["reps"];
} {
  const rawSamples = frames
    .map((frame, index) => {
      const liveAngles = getLiveAngles(frame.landmarks);
      const kneeAngle = average([liveAngles.leftKnee, liveAngles.rightKnee]);

      if (kneeAngle === null) {
        return null;
      }

      return {
        index,
        detectedAt: frame.detectedAt,
        value: kneeAngle,
      } satisfies AngleSample;
    })
    .filter((sample): sample is AngleSample => sample !== null);

  if (rawSamples.length < 5) {
    return {
      detectedRepCount: 0,
      averageRepDurationMs: null,
      averageBottomKneeAngle: null,
      primaryMetric: "knee_flexion",
      reps: [],
    };
  }

  const smoothedValues = smooth(rawSamples.map((sample) => sample.value));
  const samples = rawSamples.map((sample, index) => ({
    ...sample,
    value: smoothedValues[index],
  }));

  const valleys: Array<{ sample: AngleSample; position: number }> = [];
  const minimumValleyDistance = 4;

  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];

    if (
      current.value < previous.value &&
      current.value <= next.value &&
      current.value <= 145 &&
      (valleys.length === 0 || index - valleys[valleys.length - 1].position >= minimumValleyDistance)
    ) {
      valleys.push({ sample: current, position: index });
    }
  }

  const reps: AnalyzePayload["reps"] = [];

  for (let valleyIndex = 0; valleyIndex < valleys.length; valleyIndex += 1) {
    const valley = valleys[valleyIndex].sample;
    const valleyPosition = valleys[valleyIndex].position;
    const previousBoundary = valleyIndex === 0 ? 0 : valleys[valleyIndex - 1].position;
    const nextBoundary = valleyIndex === valleys.length - 1 ? samples.length - 1 : valleys[valleyIndex + 1].position;
    const beforeWindow = samples.slice(previousBoundary, valleyPosition + 1);
    const afterWindow = samples.slice(valleyPosition, nextBoundary + 1);

    if (beforeWindow.length === 0 || afterWindow.length === 0) {
      continue;
    }

    const start = beforeWindow.reduce((best, sample) => (sample.value > best.value ? sample : best), beforeWindow[0]);
    const end = afterWindow.reduce((best, sample) => (sample.value > best.value ? sample : best), afterWindow[0]);
    const amplitude = Math.min(start.value, end.value) - valley.value;
    const durationMs = end.detectedAt - start.detectedAt;

    if (amplitude < 12 || durationMs < 400) {
      continue;
    }

    reps.push({
      repNumber: reps.length + 1,
      startMs: start.detectedAt,
      bottomMs: valley.detectedAt,
      endMs: end.detectedAt,
      durationMs,
      bottomKneeAngle: round(valley.value),
      confidence: getRepConfidence(amplitude, durationMs),
    });
  }

  return {
    detectedRepCount: reps.length,
    averageRepDurationMs: round(average(reps.map((rep) => rep.durationMs))),
    averageBottomKneeAngle: round(average(reps.map((rep) => rep.bottomKneeAngle))),
    primaryMetric: "knee_flexion",
    reps,
  };
}
