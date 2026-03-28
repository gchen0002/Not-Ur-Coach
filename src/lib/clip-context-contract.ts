export type ClipContextInferenceRequest = {
  fileName?: string;
  frameDataUrls?: string[];
};

export type ClipContextInferenceResult = {
  provider: "gemini" | "heuristic";
  inferredExercise: string | null;
  confidence: "high" | "medium" | "low";
  targetMuscles: string[];
  resistanceType: "bodyweight" | "free_weight" | "machine" | "unknown";
  sessionIntent: "form_check" | "work_set" | "demo";
  candidateExercises: string[];
  error: string | null;
};
