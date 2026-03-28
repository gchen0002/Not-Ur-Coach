export type ReferenceClipRequest = {
  exercise: string;
  muscles: string[];
  equipment: string[];
  cameraAngle: "sagittal" | "coronal" | "angled";
  variant: string;
  modelOverride?: string;
  notes?: string;
};

export type ReferenceClipShot = {
  label: string;
  durationSeconds: number;
  description: string;
};

export type ReferenceClipResult = {
  provider: "gemini" | "heuristic";
  status: "prompt_ready" | "needs_veo_access";
  title: string;
  summary: string;
  visualDirection: string[];
  shotPlan: ReferenceClipShot[];
  veoPrompt: string;
  negativePrompt: string;
  aspectRatio: "16:9" | "9:16";
  durationSeconds: number;
  error: string | null;
};

export type ReferenceVideoGenerationResult = {
  provider: "gemini" | "heuristic";
  status: "generated" | "pending" | "failed";
  model: string;
  operationName: string | null;
  videoUri: string | null;
  mimeType: string | null;
  promptPackage: ReferenceClipResult;
  error: string | null;
};
