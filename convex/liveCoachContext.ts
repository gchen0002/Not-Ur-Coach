import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { CompactAnalysisEvidence, LivePromptBudget } from "../src/lib/analysis-contract";
import type { ClipContextInferenceRequest, ClipContextInferenceResult } from "../src/lib/clip-context-contract";
import type { ExerciseCatalogEntry } from "../src/lib/exercise-intake-contract";
import type { LiveCoachContextRequest, LiveCoachContextResult } from "../src/lib/live-session-contract";

const LIVE_CONTEXT_MODEL = "gemini-3-flash-preview";
const CLIP_CONTEXT_MODEL = "gemini-2.5-flash-lite";
const CLIP_CONTEXT_FALLBACK_MODEL = "gemini-3-flash-preview";

const requestValidator = v.object({
  userHint: v.optional(v.string()),
  frameDataUrls: v.optional(v.array(v.string())),
  phaseNotes: v.optional(v.array(v.string())),
});

const clipContextRequestValidator = v.object({
  fileName: v.optional(v.string()),
  frameDataUrls: v.optional(v.array(v.string())),
});

type CompactContext = {
  exercise: {
    name: string;
    muscles: string[];
    movementPattern: string | null;
    evidenceLevel: string;
    defaultCameraAngle: string | null;
    summary: string | null;
    resistanceType: "bodyweight" | "free_weight" | "machine" | "unknown";
    requiredEquipment: string[];
  } | null;
  evidence: CompactAnalysisEvidence[];
  guardrails: string[];
};

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreExerciseHint(hint: string, exercise: ExerciseCatalogEntry) {
  const hintTokens = tokenize(hint);
  const haystack = tokenize(`${exercise.name} ${exercise.muscles.join(" ")} ${exercise.category} ${exercise.equipment.join(" ")}`);
  return hintTokens.filter((token) => haystack.includes(token)).length;
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Live coach context frames must be base64 data URLs.");
  }

  return {
    mimeType: match[1],
    data: match[2],
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

function createSessionOpenContext(
  exercise: string | null,
  targetMuscles: string[],
  guardrails: string[],
): LivePromptBudget["sessionOpenContext"] {
  return {
    exercise: exercise ?? "Unknown exercise",
    targetMuscles,
    coachingStyle: "short, actionable, booth-demo friendly",
    guardrails: guardrails.slice(0, 5),
  };
}

function rankExerciseCandidates(catalog: ExerciseCatalogEntry[], hint: string) {
  const ranked = hint.length > 0
    ? catalog
        .map((exercise) => ({ exercise, score: scoreExerciseHint(hint, exercise) }))
        .sort((left, right) => right.score - left.score)
    : catalog.map((exercise) => ({ exercise, score: 0 }));

  return ranked
    .filter((item) => item.score > 0)
    .slice(0, 6)
    .map((item) => item.exercise.name);
}

function inferSessionIntentFromHint(hint: string): ClipContextInferenceResult["sessionIntent"] {
  if (/(demo|showcase|booth|reference|example)/i.test(hint)) {
    return "demo";
  }

  if (/(top ?set|work ?set|amrap|working set|failure|heavy)/i.test(hint)) {
    return "work_set";
  }

  return "form_check";
}

function isKnownConfidence(value: unknown): value is "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low";
}

function shouldRetryWithFallbackModel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /404|not found|not supported/i.test(message);
}

async function inferExerciseFromFrames(
  ai: GoogleGenAI,
  model: string,
  candidateExercises: string[],
  options: {
    hint: string;
    frameDataUrls?: string[];
    phaseNotes?: string[];
    taskLabel: string;
    additionalRules?: string[];
  },
) {
  const responseShape = {
    exercise: candidateExercises[0] ?? null,
    confidence: "medium",
    alternativeExercises: [] as string[],
  };
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: [
        options.taskLabel,
        "Return JSON only with this exact shape:",
        JSON.stringify(responseShape),
        `Candidate exercises: ${JSON.stringify(candidateExercises)}`,
        options.hint ? `User hint: ${options.hint}` : "",
        options.phaseNotes?.length ? `Phase notes: ${JSON.stringify(options.phaseNotes.slice(0, 4))}` : "",
        ...(options.additionalRules ?? []),
        "Pick the single best candidate exercise name from the list or null if you are unsure.",
      ].filter(Boolean).join("\n\n"),
    },
  ];

  for (const frame of (options.frameDataUrls ?? []).slice(0, 3)) {
    const parsed = parseDataUrl(frame);
    parts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.data,
      },
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
  });
  const parsed = JSON.parse(extractJsonObject(response.text ?? "")) as {
    exercise?: string | null;
    confidence?: string;
    alternativeExercises?: string[];
  };

  return {
    inferredExercise: typeof parsed.exercise === "string" && candidateExercises.includes(parsed.exercise)
      ? parsed.exercise
      : null,
    confidence: isKnownConfidence(parsed.confidence) ? parsed.confidence : null,
    alternatives: Array.isArray(parsed.alternativeExercises)
      ? parsed.alternativeExercises
          .filter((name): name is string => typeof name === "string" && candidateExercises.includes(name))
          .slice(0, 4)
      : [],
  };
}

function buildResult(context: CompactContext, inferredExercise: string | null, confidence: "high" | "medium" | "low", candidateExercises: string[], error: string | null): LiveCoachContextResult {
  const resolvedExercise = context.exercise?.name ?? inferredExercise;
  const targetMuscles = context.exercise?.muscles ?? [];
  const guardrails = context.guardrails.slice(0, 5);

  return {
    inferredExercise: resolvedExercise,
    confidence,
    targetMuscles,
    guardrails,
    evidence: context.evidence.slice(0, 3),
    sessionOpenContext: createSessionOpenContext(resolvedExercise, targetMuscles, guardrails),
    candidateExercises,
    error,
  };
}

export const prepareLiveCoachContext = actionGeneric({
  args: {
    request: requestValidator,
  },
  handler: async (ctx, args) => {
    const request = args.request as LiveCoachContextRequest;
    const listCatalogRef = makeFunctionReference<"query", Record<string, never>, ExerciseCatalogEntry[]>("exercises:listCatalog");
    const resolveContextRef = makeFunctionReference<"query", { clipName: string | null }, CompactContext>("analysisContext:resolveCompactContext");
    const catalog = await ctx.runQuery(listCatalogRef, {});
    const normalizedHint = request.userHint?.trim() ?? "";
    const heuristicCandidates = rankExerciseCandidates(catalog, normalizedHint);
    const fallbackExercise = heuristicCandidates[0] ?? null;
    const fallbackContext = await ctx.runQuery(resolveContextRef, { clipName: fallbackExercise ?? (normalizedHint || null) });
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return buildResult(fallbackContext, fallbackExercise, fallbackExercise ? "medium" : "low", heuristicCandidates, null);
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const candidateExercises = (heuristicCandidates.length > 0
        ? heuristicCandidates
        : catalog.slice(0, 12).map((exercise) => exercise.name)
      ).slice(0, 12);
      const inferred = await inferExerciseFromFrames(ai, LIVE_CONTEXT_MODEL, candidateExercises, {
        hint: normalizedHint,
        frameDataUrls: request.frameDataUrls,
        phaseNotes: request.phaseNotes,
        taskLabel: "Identify the exercise being performed for a live coaching session.",
      });
      const inferredExercise = inferred.inferredExercise ?? fallbackExercise;
      const confidence = inferred.confidence ?? (inferredExercise ? "medium" : "low");
      const context = await ctx.runQuery(resolveContextRef, { clipName: inferredExercise ?? (normalizedHint || null) });

      return buildResult(
        context,
        inferredExercise,
        confidence,
        [inferredExercise, ...inferred.alternatives].filter((name): name is string => Boolean(name)),
        null,
      );
    } catch (error) {
      return buildResult(
        fallbackContext,
        fallbackExercise,
        fallbackExercise ? "medium" : "low",
        heuristicCandidates,
        error instanceof Error ? error.message : "Failed to infer live exercise context.",
      );
    }
  },
});

export const inferClipUploadContext = actionGeneric({
  args: {
    request: clipContextRequestValidator,
  },
  handler: async (ctx, args) => {
    const request = args.request as ClipContextInferenceRequest;
    const listCatalogRef = makeFunctionReference<"query", Record<string, never>, ExerciseCatalogEntry[]>("exercises:listCatalog");
    const resolveContextRef = makeFunctionReference<"query", { clipName: string | null }, CompactContext>("analysisContext:resolveCompactContext");
    const catalog = await ctx.runQuery(listCatalogRef, {});
    const normalizedHint = request.fileName?.trim() ?? "";
    const heuristicCandidates = rankExerciseCandidates(catalog, normalizedHint);
    const fallbackExercise = heuristicCandidates[0] ?? null;
    const fallbackContext = await ctx.runQuery(resolveContextRef, { clipName: fallbackExercise ?? (normalizedHint || null) });
    const allExerciseNames = catalog.map((exercise) => exercise.name);
    const fallbackResult = {
      provider: "heuristic" as const,
      inferredExercise: fallbackContext.exercise?.name ?? fallbackExercise,
      confidence: fallbackExercise ? "medium" : "low",
      targetMuscles: fallbackContext.exercise?.muscles ?? [],
      resistanceType: fallbackContext.exercise?.resistanceType ?? "unknown",
      sessionIntent: inferSessionIntentFromHint(normalizedHint),
      candidateExercises: heuristicCandidates.length > 0 ? heuristicCandidates : allExerciseNames,
      error: null,
    } satisfies ClipContextInferenceResult;
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return fallbackResult;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const candidateExercises = (heuristicCandidates.length > 0
        ? heuristicCandidates
        : allExerciseNames
      ).slice(0, 16);

      let inferred;
      try {
        inferred = await inferExerciseFromFrames(ai, CLIP_CONTEXT_MODEL, candidateExercises, {
          hint: normalizedHint,
          frameDataUrls: request.frameDataUrls,
          taskLabel: "Identify the exercise shown in this uploaded training clip so the app can prefill exercise context before analysis.",
          additionalRules: [
            "Use filename hints and visible setup together.",
            "Favor seeded gym movements over vague labels.",
            "Return high confidence only when the clip and hint clearly point to one exercise.",
          ],
        });
      } catch (error) {
        if (!shouldRetryWithFallbackModel(error)) {
          throw error;
        }

        inferred = await inferExerciseFromFrames(ai, CLIP_CONTEXT_FALLBACK_MODEL, candidateExercises, {
          hint: normalizedHint,
          frameDataUrls: request.frameDataUrls,
          taskLabel: "Identify the exercise shown in this uploaded training clip so the app can prefill exercise context before analysis.",
          additionalRules: [
            "Use filename hints and visible setup together.",
            "Favor seeded gym movements over vague labels.",
            "Return high confidence only when the clip and hint clearly point to one exercise.",
          ],
        });
      }

      const inferredExercise = inferred.inferredExercise ?? inferred.alternatives[0] ?? fallbackResult.inferredExercise;
      const context = await ctx.runQuery(resolveContextRef, { clipName: inferredExercise ?? (normalizedHint || null) });

      return {
        provider: "gemini" as const,
        inferredExercise: context.exercise?.name ?? inferredExercise,
        confidence: inferred.confidence ?? (inferredExercise ? "medium" : "low"),
        targetMuscles: context.exercise?.muscles ?? [],
        resistanceType: context.exercise?.resistanceType ?? "unknown",
        sessionIntent: inferSessionIntentFromHint(normalizedHint),
        candidateExercises: [inferredExercise, ...inferred.alternatives].filter((name): name is string => Boolean(name)),
        error: null,
      } satisfies ClipContextInferenceResult;
    } catch (error) {
      return {
        ...fallbackResult,
        error: error instanceof Error ? error.message : "Failed to infer uploaded clip context.",
      } satisfies ClipContextInferenceResult;
    }
  },
});
