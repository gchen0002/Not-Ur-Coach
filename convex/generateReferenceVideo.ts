import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type {
  ReferenceClipRequest,
  ReferenceClipResult,
  ReferenceVideoGenerationResult,
} from "../src/lib/reference-clip-contract";
import { createReferenceClipDraft } from "../src/lib/reference-clip-draft";
import { buildReferenceClipPackage } from "./generateReferenceClip";

type VideoModelListItem = {
  name: string;
  supportedActions?: string[];
};

type ModelListResponse = {
  page?: VideoModelListItem[];
  models?: VideoModelListItem[];
};

type GeneratedVideoPart = {
  uri?: string;
  mimeType?: string;
};

type VideoOperation = {
  done?: boolean;
  name?: string;
  response?: {
    generatedVideos?: Array<{
      video?: GeneratedVideoPart;
    }>;
  };
};

type PersistedReferenceRecord = {
  storageUrl: string | null;
};

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

async function listAvailableVideoModels(ai: GoogleGenAI) {
  const response = await ai.models.list({}) as ModelListResponse;
  const models = response.page ?? response.models ?? [];

  return models
    .filter((model) => Array.isArray(model.supportedActions) && model.supportedActions.includes("generateVideos"))
    .map((model) => model.name);
}

function resolvePreferredModel(availableModels: string[], requestedModel?: string) {
  if (requestedModel === "veo-3.1") {
    const mapped = availableModels.find((name) => name === "veo-3.1-generate-preview")
      || availableModels.find((name) => name.includes("veo-3.1-generate-preview"));

    if (mapped) {
      return mapped;
    }
  }

  if (requestedModel && availableModels.includes(requestedModel)) {
    return requestedModel;
  }

  const veo31Candidate = availableModels.find((name) => name.includes("veo-3.1"));
  if (veo31Candidate) {
    return veo31Candidate;
  }

  const veo3Candidate = availableModels.find((name) => name.includes("veo-3"));
  if (veo3Candidate) {
    return veo3Candidate;
  }

  if (requestedModel === "veo-3.1") {
    return "veo-3.1-generate-preview";
  }

  return requestedModel || pickVideoModel();
}

function getGeneratedVideo(operation: VideoOperation) {
  return operation?.response?.generatedVideos?.[0]?.video ?? null;
}

export const generateReferenceVideo = actionGeneric({
  args: {
    request: referenceClipRequestValidator,
  },
  handler: async (ctx, args) => {
    const request = args.request as ReferenceClipRequest;
    const fallbackPromptPackage: ReferenceClipResult = createReferenceClipDraft(request);
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return {
        provider: "heuristic",
        status: "failed",
        model: pickVideoModel(request.modelOverride),
        operationName: null,
        videoUri: null,
        mimeType: null,
        promptPackage: fallbackPromptPackage,
        error: "Missing GEMINI_API_KEY or GOOGLE_API_KEY.",
      } satisfies ReferenceVideoGenerationResult;
    }

    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });

    try {
      const promptPackage = await buildReferenceClipPackage(request, apiKey);
      const availableModels = await listAvailableVideoModels(ai);
      const model = resolvePreferredModel(availableModels, request.modelOverride);

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

      const response = await fetch(generatedVideo.uri, {
        headers: {
          "x-goog-api-key": apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch generated video: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const storageId = await ctx.storage.store(blob);
      const upsertRef = makeFunctionReference<"mutation", {
        exercise: string;
        variant: string;
        cameraAngle: string;
        model: string;
        provider: string;
        storageId?: unknown;
        sourceUri?: string;
        promptPackage: ReferenceClipResult;
        status: string;
        error?: string;
      }, boolean>("referenceVideos:upsertReferenceVideo");
      await ctx.runMutation(upsertRef, {
        exercise: request.exercise,
        variant: request.variant,
        cameraAngle: request.cameraAngle,
        model,
        provider: "gemini",
        storageId,
        sourceUri: generatedVideo.uri,
        promptPackage,
        status: "generated",
      });

      const getRef = makeFunctionReference<"query", { exercise: string }, PersistedReferenceRecord | null>(
        "referenceVideos:getByExercise",
      );
      const persisted = await ctx.runQuery(getRef, { exercise: request.exercise });

      return {
        provider: "gemini",
        status: "generated",
        model,
        operationName: operation.name ?? null,
        videoUri: persisted?.storageUrl ?? generatedVideo.uri,
        mimeType: generatedVideo.mimeType ?? null,
        promptPackage,
        error: null,
      } satisfies ReferenceVideoGenerationResult;
    } catch (error) {
      return {
        provider: "heuristic",
        status: "failed",
        model: pickVideoModel(request.modelOverride),
        operationName: null,
        videoUri: null,
        mimeType: null,
        promptPackage: fallbackPromptPackage,
        error: error instanceof Error ? error.message : "Reference video generation failed.",
      } satisfies ReferenceVideoGenerationResult;
    }
  },
});
