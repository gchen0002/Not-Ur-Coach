import type { AnalysisRunResult } from "./analysis-contract";

export type TtsRequest = {
  analysisResult: AnalysisRunResult;
};

export type TtsResponse = {
  script: string;
  provider: "gemini" | "heuristic" | "local";
  audioUrl: string | null;
  mimeType: string | null;
  voiceName: string | null;
  cached: boolean;
  error: string | null;
};
