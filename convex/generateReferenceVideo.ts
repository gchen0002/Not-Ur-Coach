import { GoogleGenAI } from "@google/genai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import type {
  ReferenceClipRequest,
  ReferenceClipResult,
  ReferenceVideoGenerationResult,
} from "../src/lib/reference-clip-contract";
import { createReferenceClipDraft } from "../src/lib/reference-clip-draft";

const referenceClipRequestValidator = v.object({
  exercise: v.string(),
  muscles: v.array(v.string()),
  equipment: v.array(v.string()),
  cameraAngle: v.union(v.literal("sagittal"), v.literal("coronal"), v.literal("angled")),
  variant: v.string(),
  modelOverride: v.optional(v.string()),
  notes: v.optional(v.string()),
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickVideoModel(modelOverride?: string) {
  return modelOverride || process.env.VEO_MODEL || "veo-2.0-generate-001";
}

function getGeneratedVideo(operation: any) {
  return operation?.response?.generatedVideos?.[0]?.video ?? null;
}

export const generateReferenceVideo = actionGeneric({
  args: {
    request: referenceClipRequestValidator,
  },
  handler: async (_ctx, args) => {
    const request = args.request as ReferenceClipRequest;
    const promptPackage: ReferenceClipResult = createReferenceClipDraft(request);
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return {
        provider: "heuristic",
        status: "failed",
        model: pickVideoModel(request.modelOverride),
        operationName: null,
        videoUri: null,
        mimeType: null,
        promptPackage,
        error: "Missing GEMINI_API_KEY or GOOGLE_API_KEY.",
      } satisfies ReferenceVideoGenerationResult;
    }

    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    const model = pickVideoModel(request.modelOverride);

    try {
      let operation = await ai.models.generateVideos({
        model,
        source: {
          prompt: promptPackage.veoPrompt,
        },
        config: {
          numberOfVideos: 1,
          aspectRatio: promptPackage.aspectRatio,
          durationSeconds: promptPackage.durationSeconds,
        },
      });

      for (let attempt = 0; attempt < 18; attempt += 1) {
        if (operation.done) {
          break;
        }

        await sleep(10000);
        operation = await ai.operations.getVideosOperation({ operation });
      }

      if (!operation.done) {
        return {
          provider: "gemini",
          status: "pending",
          model,
          operationName: operation.name ?? null,
          videoUri: null,
          mimeType: null,
          promptPackage,
          error: "Video generation started but did not finish before the polling window ended.",
        } satisfies ReferenceVideoGenerationResult;
      }

      const generatedVideo = getGeneratedVideo(operation);

      if (!generatedVideo?.uri) {
        return {
          provider: "gemini",
          status: "failed",
          model,
          operationName: operation.name ?? null,
          videoUri: null,
          mimeType: null,
          promptPackage,
          error: "Generation finished but no video URI was returned.",
        } satisfies ReferenceVideoGenerationResult;
      }

      return {
        provider: "gemini",
        status: "generated",
        model,
        operationName: operation.name ?? null,
        videoUri: generatedVideo.uri,
        mimeType: generatedVideo.mimeType ?? null,
        promptPackage,
        error: null,
      } satisfies ReferenceVideoGenerationResult;
    } catch (error) {
      return {
        provider: "heuristic",
        status: "failed",
        model,
        operationName: null,
        videoUri: null,
        mimeType: null,
        promptPackage,
        error: error instanceof Error ? error.message : "Reference video generation failed.",
      } satisfies ReferenceVideoGenerationResult;
    }
  },
});
