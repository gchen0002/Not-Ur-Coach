import type { AnalysisRunResult } from "./analysis-contract";

export type TempoTrackRequest = {
  analysisResult: AnalysisRunResult;
};

export type TempoTrackResponse = {
  provider: "lyria" | "heuristic";
  status: "ready" | "fallback" | "failed";
  bpm: number;
  tempoPattern: string;
  style: string;
  prompt: string;
  audioUrl: string | null;
  mimeType: string | null;
  cached: boolean;
  error: string | null;
};
