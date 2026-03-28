export type ExercisePrimaryMetric = "knee_flexion" | "hip_flexion";

export type ExerciseMovementPattern = "squat" | "hinge" | "upper" | "other";

export type ExerciseMovementProfile = {
  pattern: ExerciseMovementPattern;
  primaryMetric: ExercisePrimaryMetric;
  prefersSingleSide: boolean;
  romIdeal: number;
  shallowThreshold: number;
  setupGuidance: string;
};

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
}

export function resolveExerciseMovementProfile(exerciseName?: string | null): ExerciseMovementProfile {
  const normalized = normalize(exerciseName);

  if (/(rdl|sldl|deadlift|hip hinge|good morning)/.test(normalized)) {
    return {
      pattern: "hinge",
      primaryMetric: "hip_flexion",
      prefersSingleSide: true,
      romIdeal: 95,
      shallowThreshold: 125,
      setupGuidance: "Keep one shoulder-to-ankle side chain visible through the whole hinge.",
    };
  }

  if (/(squat|leg press|lunge|split squat|rfess|leg curl|leg extension)/.test(normalized)) {
    return {
      pattern: "squat",
      primaryMetric: "knee_flexion",
      prefersSingleSide: false,
      romIdeal: 95,
      shallowThreshold: 135,
      setupGuidance: "Keep hips, knees, and ankles visible for the whole rep.",
    };
  }

  if (/(row|press|pull|curl|raise|bench|pulldown|overhead)/.test(normalized)) {
    return {
      pattern: "upper",
      primaryMetric: "hip_flexion",
      prefersSingleSide: true,
      romIdeal: 110,
      shallowThreshold: 145,
      setupGuidance: "Keep the main working side visible and avoid cropping the shoulder or elbow.",
    };
  }

  return {
    pattern: "other",
    primaryMetric: "knee_flexion",
    prefersSingleSide: true,
    romIdeal: 100,
    shallowThreshold: 140,
    setupGuidance: "Keep one full body side chain visible whenever possible.",
  };
}
