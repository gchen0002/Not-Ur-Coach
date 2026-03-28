import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { CompactAnalysisEvidence, LivePromptBudget } from "../src/lib/analysis-contract";
import type { ExerciseCatalogEntry } from "../src/lib/exercise-intake-contract";
import type { LiveCoachContextRequest, LiveCoachContextResult } from "../src/lib/live-session-contract";

const LIVE_CONTEXT_MODEL = "gemini-3-flash-preview";

const requestValidator = v.object({
  userHint: v.optional(v.string()),
  frameDataUrls: v.optional(v.array(v.string())),
  phaseNotes: v.optional(v.array(v.string())),
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
    const ranked = normalizedHint.length > 0
      ? catalog
          .map((exercise) => ({ exercise, score: scoreExerciseHint(normalizedHint, exercise) }))
          .sort((left, right) => right.score - left.score)
      : catalog.map((exercise) => ({ exercise, score: 0 }));
    const heuristicCandidates = ranked
      .filter((item) => item.score > 0)
      .slice(0, 6)
      .map((item) => item.exercise.name);
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
      const responseShape = {
        exercise: candidateExercises[0] ?? null,
        confidence: "medium",
        alternativeExercises: [] as string[],
      };
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        {
          text: [
            "Identify the exercise being performed for a live coaching session.",
            "Return JSON only with this exact shape:",
            JSON.stringify(responseShape),
            `Candidate exercises: ${JSON.stringify(candidateExercises)}`,
            normalizedHint ? `User hint: ${normalizedHint}` : "",
            request.phaseNotes?.length ? `Phase notes: ${JSON.stringify(request.phaseNotes.slice(0, 4))}` : "",
            "Pick the single best candidate exercise name from the list or null if you are unsure.",
          ].filter(Boolean).join("\n\n"),
        },
      ];

      for (const frame of (request.frameDataUrls ?? []).slice(0, 3)) {
        const parsed = parseDataUrl(frame);
        parts.push({
          inlineData: {
            mimeType: parsed.mimeType,
            data: parsed.data,
          },
        });
      }

      const response = await ai.models.generateContent({
        model: LIVE_CONTEXT_MODEL,
        contents: [{ role: "user", parts }],
      });
      const parsed = JSON.parse(extractJsonObject(response.text ?? "")) as {
        exercise?: string | null;
        confidence?: string;
        alternativeExercises?: string[];
      };
      const inferredExercise = typeof parsed.exercise === "string" && candidateExercises.includes(parsed.exercise)
        ? parsed.exercise
        : fallbackExercise;
      const confidence = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
        ? parsed.confidence
        : inferredExercise ? "medium" : "low";
      const context = await ctx.runQuery(resolveContextRef, { clipName: inferredExercise ?? (normalizedHint || null) });
      const alternatives = Array.isArray(parsed.alternativeExercises)
        ? parsed.alternativeExercises.filter((name): name is string => typeof name === "string" && candidateExercises.includes(name)).slice(0, 4)
        : [];

      return buildResult(
        context,
        inferredExercise,
        confidence,
        [inferredExercise, ...alternatives].filter((name): name is string => Boolean(name)),
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
