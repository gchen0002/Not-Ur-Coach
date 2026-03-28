import { GoogleGenAI } from "@google/genai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import type { ReferenceClipRequest, ReferenceClipResult } from "../src/lib/reference-clip-contract";
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

function sanitizeReferenceClip(candidate: unknown, fallback: ReferenceClipResult): ReferenceClipResult {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const result = candidate as Partial<ReferenceClipResult>;

  if (
    (result.provider !== "gemini" && result.provider !== "heuristic") ||
    (result.status !== "prompt_ready" && result.status !== "needs_veo_access") ||
    typeof result.title !== "string" ||
    typeof result.summary !== "string" ||
    !Array.isArray(result.visualDirection) ||
    !Array.isArray(result.shotPlan) ||
    typeof result.veoPrompt !== "string" ||
    typeof result.negativePrompt !== "string" ||
    (result.aspectRatio !== "16:9" && result.aspectRatio !== "9:16") ||
    typeof result.durationSeconds !== "number"
  ) {
    return fallback;
  }

  return {
    provider: result.provider,
    status: result.status,
    title: result.title.trim() || fallback.title,
    summary: result.summary.trim() || fallback.summary,
    visualDirection: result.visualDirection.filter((item): item is string => typeof item === "string").slice(0, 4),
    shotPlan: result.shotPlan
      .filter((shot): shot is ReferenceClipResult["shotPlan"][number] =>
        Boolean(shot) &&
        typeof shot === "object" &&
        typeof shot.label === "string" &&
        typeof shot.durationSeconds === "number" &&
        typeof shot.description === "string",
      )
      .slice(0, 4),
    veoPrompt: result.veoPrompt.trim() || fallback.veoPrompt,
    negativePrompt: result.negativePrompt.trim() || fallback.negativePrompt,
    aspectRatio: result.aspectRatio,
    durationSeconds: Math.max(5, Math.min(8, Math.round(result.durationSeconds))),
    error: null,
  };
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON object.");
  }

  return text.slice(start, end + 1);
}

export async function buildReferenceClipPackage(
  request: ReferenceClipRequest,
  apiKey?: string,
): Promise<ReferenceClipResult> {
  const fallback = createReferenceClipDraft(request);

  if (!apiKey) {
    return fallback;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        "You are preparing a Veo reference-clip generation package for a fitness coaching app.",
        "Return JSON only.",
        "Produce a concise shot plan and a Veo-ready prompt for an ideal-form reference video.",
        "Use this exact shape:",
        JSON.stringify(fallback),
        "Hard rules:",
        "- Keep visualDirection to 3 or 4 short items.",
        "- Keep shotPlan to 3 or 4 shots.",
        "- Keep duration between 8 and 12 seconds.",
        "- Full body must stay visible for the whole clip.",
        `Request: ${JSON.stringify(request)}`,
        `Fallback draft: ${JSON.stringify(fallback)}`,
      ].join("\n\n"),
    });

    const parsed = JSON.parse(extractJsonObject(response.text ?? ""));
    return sanitizeReferenceClip(parsed, { ...fallback, provider: "gemini" });
  } catch (error) {
    return {
      ...fallback,
      provider: "heuristic",
      status: "prompt_ready",
      error: error instanceof Error ? error.message : "Reference clip prompt generation failed.",
    };
  }
}

export const generateReferenceClip = actionGeneric({
  args: {
    request: referenceClipRequestValidator,
  },
  handler: async (_ctx, args) => {
    const request = args.request as ReferenceClipRequest;
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    return await buildReferenceClipPackage(request, apiKey);
  },
});
