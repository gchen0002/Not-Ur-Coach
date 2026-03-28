import type { AnalysisRunResult } from "./analysis-contract";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  provider?: "gemini" | "heuristic" | "local";
};

export type ChatReply = {
  message: ChatMessage;
  provider: "gemini" | "heuristic" | "local";
  error: string | null;
};

export type ChatRequest = {
  analysisResult: AnalysisRunResult;
  messages: ChatMessage[];
  prompt: string;
};
