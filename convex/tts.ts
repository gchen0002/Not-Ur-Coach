import { GoogleGenAI } from "@google/genai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import type { AnalysisRunResult } from "../src/lib/analysis-contract";
import type { TtsRequest, TtsResponse } from "../src/lib/tts-contract";
import { createLocalTtsResponse } from "../src/lib/tts-draft";

const analysisResultValidator = v.object({
  accepted: v.boolean(),
  mode: v.union(v.literal("full"), v.literal("best_effort"), v.literal("reject")),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  summary: v.string(),
  nextStep: v.string(),
  provider: v.union(v.literal("gemini"), v.literal("heuristic"), v.literal("local")),
  geminiError: v.union(v.string(), v.null()),
  draft: v.any(),
  fallbackDraft: v.any(),
  payload: v.any(),
});

export const speakAnalysis = actionGeneric({
  args: {
    analysisResult: analysisResultValidator,
  },
  handler: async (_ctx, args) => {
    const request = args as TtsRequest;
    const fallback = createLocalTtsResponse(request.analysisResult as AnalysisRunResult);
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return fallback satisfies TtsResponse;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          "Write a short spoken coaching script for text-to-speech.",
          "Keep it to 2 or 3 short sentences.",
          "Use plain spoken language. No bullet points. No markdown.",
          "Mention uncertainty clearly if this is a best-effort or reject analysis.",
          `Analysis result: ${JSON.stringify(request.analysisResult)}`,
        ].join("\n\n"),
      });

      const script = (response.text ?? "").trim();

      if (!script) {
        return {
          ...fallback,
          provider: "heuristic",
          error: "Gemini returned an empty TTS script.",
        } satisfies TtsResponse;
      }

      return {
        script,
        provider: "gemini",
        error: null,
      } satisfies TtsResponse;
    } catch (error) {
      return {
        ...fallback,
        provider: "heuristic",
        error: error instanceof Error ? error.message : "Gemini TTS script generation failed.",
      } satisfies TtsResponse;
    }
  },
});
