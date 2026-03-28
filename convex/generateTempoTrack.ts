import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { TempoTrackRequest, TempoTrackResponse } from "../src/lib/tempo-track-contract";
import { createTempoTrackDraft } from "../src/lib/tempo-track-draft";

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

  return `tempo-${Math.abs(hash)}`;
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

export const generateTempoTrack = actionGeneric({
  args: {
    analysisResult: analysisResultValidator,
  },
  handler: async (ctx, args) => {
    const request = args as TempoTrackRequest;
    const fallback = createTempoTrackDraft(request.analysisResult);
    const cacheKey = createCacheKey(`${fallback.tempoPattern}:${fallback.bpm}:${fallback.style}`);
    const cacheQuery = makeFunctionReference<"query", { cacheKey: string }, {
      audioUrl: string | null;
      mimeType?: string;
      bpm: number;
      tempoPattern: string;
      style: string;
      prompt: string;
      provider: string;
      status: string;
      error?: string;
    } | null>("tempoTracks:getByCacheKey");
    const cached = await ctx.runQuery(cacheQuery, { cacheKey });

    if (cached?.audioUrl) {
      return {
        provider: cached.provider === "lyria" ? "lyria" : "heuristic",
        status: cached.status === "ready" ? "ready" : "fallback",
        bpm: cached.bpm,
        tempoPattern: cached.tempoPattern,
        style: cached.style,
        prompt: cached.prompt,
        audioUrl: cached.audioUrl,
        mimeType: cached.mimeType ?? null,
        cached: true,
        error: cached.error ?? null,
      } satisfies TempoTrackResponse;
    }

    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return fallback;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "lyria-3-clip",
        contents: [{
          role: "user",
          parts: [{ text: fallback.prompt }],
        }],
        config: {
          responseModalities: ["AUDIO"],
        },
      });

      const audioPart = extractAudioPart(response);
      if (!audioPart?.data) {
        return {
          ...fallback,
          error: "Lyria returned no audio track.",
        };
      }

      const storageId = await ctx.storage.store(new Blob([Buffer.from(audioPart.data, "base64")], {
        type: audioPart.mimeType ?? "audio/wav",
      }));

      const upsertRef = makeFunctionReference<"mutation", {
        cacheKey: string;
        bpm: number;
        tempoPattern: string;
        style: string;
        prompt: string;
        provider: string;
        storageId?: string;
        mimeType?: string;
        status: string;
        error?: string;
      }, boolean>("tempoTracks:upsert");
      await ctx.runMutation(upsertRef, {
        cacheKey,
        bpm: fallback.bpm,
        tempoPattern: fallback.tempoPattern,
        style: fallback.style,
        prompt: fallback.prompt,
        provider: "lyria",
        storageId,
        mimeType: audioPart.mimeType ?? "audio/wav",
        status: "ready",
      });

      const persisted = await ctx.runQuery(cacheQuery, { cacheKey });
      return {
        provider: "lyria",
        status: "ready",
        bpm: fallback.bpm,
        tempoPattern: fallback.tempoPattern,
        style: fallback.style,
        prompt: fallback.prompt,
        audioUrl: persisted?.audioUrl ?? null,
        mimeType: audioPart.mimeType ?? "audio/wav",
        cached: false,
        error: null,
      } satisfies TempoTrackResponse;
    } catch (error) {
      return {
        ...fallback,
        error: error instanceof Error ? error.message : "Tempo track generation failed.",
      } satisfies TempoTrackResponse;
    }
  },
});
