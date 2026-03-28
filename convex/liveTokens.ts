import { GoogleGenAI, Modality } from "@google/genai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import type { LiveAuthTokenRequest, LiveAuthTokenResult } from "../src/lib/live-session-contract";

const requestValidator = v.object({
  context: v.object({
    inferredExercise: v.union(v.string(), v.null()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    targetMuscles: v.array(v.string()),
    guardrails: v.array(v.string()),
    evidence: v.array(v.object({
      tier: v.union(v.literal("exercise"), v.literal("movement_family"), v.literal("heuristic")),
      finding: v.string(),
      source: v.string(),
    })),
    sessionOpenContext: v.object({
      exercise: v.string(),
      targetMuscles: v.array(v.string()),
      coachingStyle: v.string(),
      guardrails: v.array(v.string()),
    }),
    candidateExercises: v.array(v.string()),
    error: v.union(v.string(), v.null()),
  }),
});

const LIVE_MODEL = "gemini-3.1-flash-live-preview";

function buildSystemInstruction(request: LiveAuthTokenRequest) {
  const evidenceLines = request.context.evidence
    .slice(0, 3)
    .map((item) => `- ${item.finding} (${item.source})`)
    .join("\n");

  return [
    "You are a live biomechanics coach for Not Ur Coach.",
    `Exercise: ${request.context.sessionOpenContext.exercise}`,
    `Target muscles: ${request.context.sessionOpenContext.targetMuscles.join(", ") || "Unknown"}`,
    `Style: ${request.context.sessionOpenContext.coachingStyle}`,
    "Guardrails:",
    ...request.context.sessionOpenContext.guardrails.map((item) => `- ${item}`),
    evidenceLines ? `Evidence:\n${evidenceLines}` : "",
    "Only give short, actionable cues tied to the visible movement.",
    "If visibility is poor, say that briefly instead of overclaiming.",
  ].filter(Boolean).join("\n\n");
}

export const createLiveAuthToken = actionGeneric({
  args: {
    request: requestValidator,
  },
  handler: async (_ctx, args) => {
    const request = args.request as LiveAuthTokenRequest;
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return {
        tokenName: null,
        model: LIVE_MODEL,
        expiresAt: null,
        error: "Missing GEMINI_API_KEY or GOOGLE_API_KEY.",
      } satisfies LiveAuthTokenResult;
    }

    try {
      const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
      const expiresAt = new Date(Date.now() + (20 * 60 * 1000)).toISOString();
      const newSessionExpiresAt = new Date(Date.now() + (5 * 60 * 1000)).toISOString();
      const token = await ai.authTokens.create({
        config: {
          uses: 3,
          expireTime: expiresAt,
          newSessionExpireTime: newSessionExpiresAt,
          liveConnectConstraints: {
            model: LIVE_MODEL,
            config: {
              responseModalities: [Modality.TEXT],
              systemInstruction: buildSystemInstruction(request),
              sessionResumption: {
                transparent: true,
              },
            },
          },
          lockAdditionalFields: ["temperature", "responseModalities", "systemInstruction"],
        },
      });

      return {
        tokenName: token.name ?? null,
        model: LIVE_MODEL,
        expiresAt,
        error: null,
      } satisfies LiveAuthTokenResult;
    } catch (error) {
      return {
        tokenName: null,
        model: LIVE_MODEL,
        expiresAt: null,
        error: error instanceof Error ? error.message : "Failed to create Gemini Live auth token.",
      } satisfies LiveAuthTokenResult;
    }
  },
});
