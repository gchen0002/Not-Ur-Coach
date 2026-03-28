import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
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

function createCacheKey(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return `tts-${Math.abs(hash)}`;
}

function extractAudioPart(response: unknown) {
  const candidate = (response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { data?: string; mimeType?: string };
        }>;
      };
    }>;
  }).candidates?.[0];

  return candidate?.content?.parts?.find((part) => Boolean(part.inlineData?.data))?.inlineData ?? null;
}

export const speakAnalysis = actionGeneric({
  args: {
    analysisResult: analysisResultValidator,
  },
  handler: async (ctx, args) => {
    const request = args as TtsRequest;
    const fallback = createLocalTtsResponse(request.analysisResult as AnalysisRunResult);
    const voiceName = "Kore";
    const cacheKey = createCacheKey(`${voiceName}:${fallback.script}`);
    const cacheQuery = makeFunctionReference<"query", { cacheKey: string }, {
      audioUrl: string | null;
      mimeType?: string;
      voiceName?: string;
      provider: string;
      error?: string;
    } | null>("ttsCache:getByCacheKey");
    const cached = await ctx.runQuery(cacheQuery, { cacheKey });

    if (cached?.audioUrl) {
      return {
        script: fallback.script,
        provider: cached.provider === "gemini" ? "gemini" : "heuristic",
        audioUrl: cached.audioUrl,
        mimeType: cached.mimeType ?? null,
        voiceName: cached.voiceName ?? voiceName,
        cached: true,
        error: cached.error ?? null,
      } satisfies TtsResponse;
    }

    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return fallback satisfies TtsResponse;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const audioResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{
          role: "user",
          parts: [{ text: fallback.script }],
        }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      });
      const audioPart = extractAudioPart(audioResponse);

      if (audioPart?.data) {
        const storageId = await ctx.storage.store(new Blob([Buffer.from(audioPart.data, "base64")], {
          type: audioPart.mimeType ?? "audio/wav",
        }));
        const upsertRef = makeFunctionReference<"mutation", {
          cacheKey: string;
          script: string;
          provider: string;
          voiceName?: string;
          storageId?: string;
          mimeType?: string;
          error?: string;
        }, boolean>("ttsCache:upsert");
        await ctx.runMutation(upsertRef, {
          cacheKey,
          script: fallback.script,
          provider: "gemini",
          voiceName,
          storageId,
          mimeType: audioPart.mimeType ?? "audio/wav",
        });

        const persisted = await ctx.runQuery(cacheQuery, { cacheKey });
        return {
          script: fallback.script,
          provider: "gemini",
          audioUrl: persisted?.audioUrl ?? null,
          mimeType: audioPart.mimeType ?? "audio/wav",
          voiceName,
          cached: false,
          error: null,
        } satisfies TtsResponse;
      }

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
        audioUrl: null,
        mimeType: null,
        voiceName,
        cached: false,
        error: null,
      } satisfies TtsResponse;
    } catch (error) {
      return {
        ...fallback,
        provider: "heuristic",
        voiceName,
        error: error instanceof Error ? error.message : "Gemini TTS script generation failed.",
      } satisfies TtsResponse;
    }
  },
});
