import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  type ExerciseCatalogEntry,
  type GeneratedExerciseDraft,
  type ExerciseIntakeRequest,
  type ExerciseIntakeResult,
} from "../src/lib/exercise-intake-contract";
import { SEEDED_EXERCISE_CATALOG } from "../src/lib/exercise-catalog";
import { createGeneratedExerciseDraft, resolveExerciseIntake } from "../src/lib/exercise-intake-draft";
import { createReferenceClipRequestFromExercise } from "../src/lib/reference-clip-draft";

const exerciseIntakeValidator = v.object({
  description: v.string(),
});

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON object.");
  }
  return text.slice(start, end + 1);
}

function sanitizeStringArray(candidate: unknown, fallback: string[]) {
  if (!Array.isArray(candidate)) {
    return fallback;
  }

  const values = candidate
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length > 0 ? values : fallback;
}

function sanitizeMatchedExercise(candidate: unknown, catalog: ExerciseCatalogEntry[]) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const name = typeof (candidate as { name?: unknown }).name === "string"
    ? (candidate as { name: string }).name.trim().toLowerCase()
    : "";

  return catalog.find((entry) => entry.name.toLowerCase() === name) ?? null;
}

function sanitizeSuggestions(candidate: unknown, fallback: ExerciseCatalogEntry[], catalog: ExerciseCatalogEntry[]) {
  if (!Array.isArray(candidate)) {
    return fallback;
  }

  const suggestions = candidate
    .map((item) => sanitizeMatchedExercise(item, catalog))
    .filter((item): item is ExerciseCatalogEntry => Boolean(item));

  return suggestions.length > 0 ? suggestions.slice(0, 3) : fallback;
}

function sanitizeGeneratedExercise(candidate: unknown, fallback: GeneratedExerciseDraft) {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const result = candidate as Partial<GeneratedExerciseDraft>;
  const category = typeof result.category === "string" && result.category.trim().length > 0
    ? result.category.trim()
    : fallback.category;
  const defaultCameraAngle = result.defaultCameraAngle === "coronal" || result.defaultCameraAngle === "angled"
    ? result.defaultCameraAngle
    : fallback.defaultCameraAngle;

  return {
    name: typeof result.name === "string" && result.name.trim().length > 0 ? result.name.trim() : fallback.name,
    muscles: sanitizeStringArray(result.muscles, fallback.muscles),
    category,
    equipment: sanitizeStringArray(result.equipment, fallback.equipment),
    defaultCameraAngle,
    evidenceLevel: typeof result.evidenceLevel === "string" && result.evidenceLevel.trim().length > 0
      ? result.evidenceLevel.trim()
      : fallback.evidenceLevel,
    isAiGenerated: true,
    summary: typeof result.summary === "string" && result.summary.trim().length > 0 ? result.summary.trim() : fallback.summary,
    primaryJoints: sanitizeStringArray(result.primaryJoints, fallback.primaryJoints),
    movementPattern: typeof result.movementPattern === "string" && result.movementPattern.trim().length > 0
      ? result.movementPattern.trim()
      : fallback.movementPattern,
    referenceVariant: typeof result.referenceVariant === "string" && result.referenceVariant.trim().length > 0
      ? result.referenceVariant.trim()
      : fallback.referenceVariant,
  };
}

function sanitizeExerciseResult(
  candidate: unknown,
  fallback: ExerciseIntakeResult,
  request: ExerciseIntakeRequest,
  catalog: ExerciseCatalogEntry[],
): ExerciseIntakeResult {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const result = candidate as Partial<ExerciseIntakeResult>;
  const status = result.status === "matched" || result.status === "generated" || result.status === "unclear"
    ? result.status
    : fallback.status;

  if (status === "matched") {
    const matchedExercise = sanitizeMatchedExercise(result.matchedExercise, catalog) ?? fallback.matchedExercise;
    return {
      provider: "gemini",
      status: matchedExercise ? "matched" : fallback.status,
      matchedExercise,
      generatedExercise: null,
      suggestions: sanitizeSuggestions(result.suggestions, fallback.suggestions, catalog),
      referenceRequest: null,
      error: typeof result.error === "string" ? result.error : null,
    };
  }

  if (status === "generated") {
    const fallbackGeneratedExercise = fallback.generatedExercise ?? createGeneratedExerciseDraft(request.description);
    const generatedExercise = sanitizeGeneratedExercise(result.generatedExercise, fallbackGeneratedExercise);
    return {
      provider: "gemini",
      status: "generated",
      matchedExercise: null,
      generatedExercise,
      suggestions: sanitizeSuggestions(result.suggestions, fallback.suggestions, catalog),
      referenceRequest: createReferenceClipRequestFromExercise(generatedExercise, {
        variant: generatedExercise.referenceVariant,
      }),
      error: typeof result.error === "string" ? result.error : null,
    };
  }

  return {
    ...fallback,
    provider: "gemini",
    status: "unclear",
    error: typeof result.error === "string" ? result.error : fallback.error,
  };
}

export const generateExercise = actionGeneric({
  args: {
    request: exerciseIntakeValidator,
  },
  handler: async (ctx, args) => {
    const request = args.request as ExerciseIntakeRequest;
    const fallback = resolveExerciseIntake(request, SEEDED_EXERCISE_CATALOG);
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      if (fallback.status === "generated" && fallback.generatedExercise) {
        const upsertRef = makeFunctionReference<"mutation", { exercise: GeneratedExerciseDraft }, ExerciseCatalogEntry>(
          "exercises:upsertGeneratedExercise",
        );
        await ctx.runMutation(upsertRef, { exercise: fallback.generatedExercise });
      }

      return fallback satisfies ExerciseIntakeResult;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          "You help a fitness app decide whether a user-described exercise already exists in the seeded catalog.",
          "Return JSON only.",
          "Use this exact shape:",
          JSON.stringify(fallback),
          "Rules:",
          "- If the description clearly matches an existing seeded exercise, return status=matched and fill matchedExercise.",
          "- If it does not clearly match, return status=generated and propose a concise generatedExercise draft.",
          "- generatedExercise must include: name, muscles, category, equipment, defaultCameraAngle, summary, primaryJoints, movementPattern, and referenceVariant.",
          "- Keep suggestions to up to 3 seeded exercises.",
          `Seeded catalog: ${JSON.stringify(SEEDED_EXERCISE_CATALOG)}`,
          `User description: ${request.description}`,
        ].join("\n\n"),
      });

      const parsed = JSON.parse(extractJsonObject(response.text ?? ""));
      const result = sanitizeExerciseResult(parsed, fallback, request, SEEDED_EXERCISE_CATALOG);

      if (result.status === "generated" && result.generatedExercise) {
        const upsertRef = makeFunctionReference<"mutation", { exercise: GeneratedExerciseDraft }, ExerciseCatalogEntry>(
          "exercises:upsertGeneratedExercise",
        );
        await ctx.runMutation(upsertRef, { exercise: result.generatedExercise });
      }

      return result satisfies ExerciseIntakeResult;
    } catch (error) {
      const fallbackResult = {
        ...fallback,
        provider: "heuristic",
        error: error instanceof Error ? error.message : fallback.error,
      } satisfies ExerciseIntakeResult;

      if (fallbackResult.status === "generated" && fallbackResult.generatedExercise) {
        const upsertRef = makeFunctionReference<"mutation", { exercise: GeneratedExerciseDraft }, ExerciseCatalogEntry>(
          "exercises:upsertGeneratedExercise",
        );
        await ctx.runMutation(upsertRef, { exercise: fallbackResult.generatedExercise });
      }

      return fallbackResult;
    }
  },
});
