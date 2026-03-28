import type { ReferenceClipRequest } from "./reference-clip-contract";

export type ExerciseCatalogEntry = {
  name: string;
  muscles: string[];
  category: string;
  equipment: string[];
  defaultCameraAngle: "sagittal" | "coronal" | "angled";
  evidenceLevel?: string;
  isAiGenerated?: boolean;
  summary?: string;
};

export type GeneratedExerciseDraft = ExerciseCatalogEntry & {
  summary: string;
  primaryJoints: string[];
  movementPattern: string;
  referenceVariant: string;
};

export type ExerciseIntakeRequest = {
  description: string;
};

export type ExerciseIntakeResult = {
  provider: "gemini" | "heuristic";
  status: "matched" | "generated" | "unclear";
  matchedExercise: ExerciseCatalogEntry | null;
  generatedExercise: GeneratedExerciseDraft | null;
  suggestions: ExerciseCatalogEntry[];
  referenceRequest: ReferenceClipRequest | null;
  error: string | null;
};
