import type { AnalysisRunResult } from "./analysis-contract";

export type TtsRequest = {
  analysisResult: AnalysisRunResult;
};

export type TtsResponse = {
  script: string;
  provider: "gemini" | "heuristic" | "local";
  error: string | null;
};
