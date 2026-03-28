import { GoogleGenAI } from "@google/genai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import type { AnalysisDraft, AnalysisRunResult, AnalyzePayload } from "../src/lib/analysis-contract";
import { createAnalysisDraft } from "../src/lib/analysis-draft";

const analyzePayloadValidator = v.object({
  sourceType: v.union(v.literal("camera"), v.literal("clip"), v.null()),
  clipName: v.union(v.string(), v.null()),
  decision: v.union(v.literal("full"), v.literal("best_effort"), v.literal("reject")),
  recommendation: v.string(),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  cameraAngle: v.object({
    label: v.union(
      v.literal("sagittal"),
      v.literal("coronal"),
      v.literal("angled"),
      v.literal("unknown"),
    ),
    confidence: v.number(),
  }),
  frameStats: v.object({
    sampledFrames: v.number(),
    fullFrames: v.number(),
    bestEffortFrames: v.number(),
    rejectedFrames: v.number(),
    averageVisibleLandmarks: v.number(),
    latestVisibleLandmarks: v.number(),
    captureWindowMs: v.number(),
  }),
  quality: v.object({
    currentReadiness: v.union(v.literal("ready"), v.literal("adjusting"), v.literal("blocked")),
    currentReason: v.string(),
    currentIssues: v.array(v.string()),
    windowIssues: v.array(v.string()),
  }),
  motionSummary: v.object({
    dominantSide: v.union(v.literal("left"), v.literal("right"), v.null()),
    trunkLean: v.union(v.number(), v.null()),
    leftKnee: v.union(v.number(), v.null()),
    rightKnee: v.union(v.number(), v.null()),
    leftHip: v.union(v.number(), v.null()),
    rightHip: v.union(v.number(), v.null()),
  }),
  repStats: v.object({
    detectedRepCount: v.number(),
    averageRepDurationMs: v.union(v.number(), v.null()),
    averageBottomKneeAngle: v.union(v.number(), v.null()),
    primaryMetric: v.literal("knee_flexion"),
  }),
  reps: v.array(v.object({
    repNumber: v.number(),
    startMs: v.number(),
    bottomMs: v.number(),
    endMs: v.number(),
    durationMs: v.number(),
    bottomKneeAngle: v.union(v.number(), v.null()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  })),
  geminiInstructions: v.array(v.string()),
});

function sanitizeGeminiDraft(candidate: unknown, fallback: AnalysisDraft): AnalysisDraft {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const draft = candidate as Partial<AnalysisDraft>;

  if (
    typeof draft.accepted !== "boolean" ||
    (draft.mode !== "full" && draft.mode !== "best_effort" && draft.mode !== "reject") ||
    (draft.confidence !== "high" && draft.confidence !== "medium" && draft.confidence !== "low") ||
    typeof draft.summary !== "string" ||
    !draft.basicAnalysis ||
    typeof draft.basicAnalysis !== "object" ||
    !Array.isArray(draft.cues) ||
    !Array.isArray(draft.risks) ||
    typeof draft.nextStep !== "string" ||
    !draft.scores ||
    typeof draft.scores !== "object"
  ) {
    return fallback;
  }

  const sanitized: AnalysisDraft = {
    accepted: draft.accepted,
    mode: draft.mode,
    confidence: draft.confidence,
    summary: draft.summary.trim() || fallback.summary,
    basicAnalysis: {
      summary:
        typeof draft.basicAnalysis.summary === "string" && draft.basicAnalysis.summary.trim().length > 0
          ? draft.basicAnalysis.summary.trim()
          : fallback.basicAnalysis.summary,
      whatYoureDoingWell: Array.isArray(draft.basicAnalysis.whatYoureDoingWell)
        ? draft.basicAnalysis.whatYoureDoingWell.filter((item): item is string => typeof item === "string").slice(0, 3)
        : fallback.basicAnalysis.whatYoureDoingWell,
      whatToFix: Array.isArray(draft.basicAnalysis.whatToFix)
        ? draft.basicAnalysis.whatToFix.filter((item): item is string => typeof item === "string").slice(0, 3)
        : fallback.basicAnalysis.whatToFix,
    },
    scores: {
      overall: typeof draft.scores.overall === "number" || draft.scores.overall === null ? draft.scores.overall : fallback.scores.overall,
      rom: typeof draft.scores.rom === "number" || draft.scores.rom === null ? draft.scores.rom : fallback.scores.rom,
      tensionProfile: typeof draft.scores.tensionProfile === "number" || draft.scores.tensionProfile === null ? draft.scores.tensionProfile : fallback.scores.tensionProfile,
      tempo: typeof draft.scores.tempo === "number" || draft.scores.tempo === null ? draft.scores.tempo : fallback.scores.tempo,
      symmetry: typeof draft.scores.symmetry === "number" || draft.scores.symmetry === null ? draft.scores.symmetry : fallback.scores.symmetry,
      fatigueManagement:
        typeof draft.scores.fatigueManagement === "number" || draft.scores.fatigueManagement === null
          ? draft.scores.fatigueManagement
          : fallback.scores.fatigueManagement,
    },
    cues: draft.cues
      .filter((cue): cue is AnalysisDraft["cues"][number] =>
        Boolean(cue) &&
        typeof cue === "object" &&
        typeof cue.cue === "string" &&
        (cue.priority === "high" || cue.priority === "medium" || cue.priority === "low"),
      )
      .slice(0, 4),
    risks: draft.risks.filter((item): item is string => typeof item === "string").slice(0, 3),
    nextStep: draft.nextStep.trim() || fallback.nextStep,
  };

  return sanitized;
}

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON object.");
  }

  return text.slice(start, end + 1);
}

async function generateGeminiDraft(payload: AnalyzePayload, fallback: AnalysisDraft) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey || payload.decision === "reject") {
    return {
      provider: "heuristic" as const,
      draft: fallback,
      error: payload.decision === "reject" ? null : "Missing GEMINI_API_KEY or GOOGLE_API_KEY.",
    };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const responseShape = {
      accepted: true,
      mode: "full",
      confidence: "high",
      summary: "",
      basicAnalysis: {
        summary: "",
        whatYoureDoingWell: [""],
        whatToFix: [""],
      },
      scores: {
        overall: 0,
        rom: 0,
        tensionProfile: 0,
        tempo: 0,
        symmetry: 0,
        fatigueManagement: 0,
      },
      cues: [{ cue: "", priority: "high" }],
      risks: [""],
      nextStep: "",
    };
    const prompt = [
      "You are generating a concise biomechanics analysis draft for a hackathon demo.",
      "Return JSON only. No markdown fences, no prose outside the JSON.",
      "Use exactly this shape and no additional keys:",
      JSON.stringify(responseShape),
      "Hard rules:",
      "- Keep whatYoureDoingWell to 0-3 items.",
      "- Keep whatToFix to 0-3 items.",
      "- Keep cues to 0-4 items.",
      "- Keep risks to 0-3 items.",
      "- Use integer scores from 0 to 100 when accepted is true.",
      "- If mode is reject, set accepted=false and every score field to null.",
      "- If mode is best_effort, mention crop/visibility limits in summary or basicAnalysis.summary.",
      "- Do not invent unseen joints or phases.",
      "- Prefer short, direct coaching language.",
      `Input payload: ${JSON.stringify(payload)}`,
      `Heuristic draft fallback: ${JSON.stringify(fallback)}`,
      "Stay faithful to the visible data and do not overclaim on hidden joints.",
    ].join("\n\n");

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    const responseText = response.text ?? "";
    const parsed = JSON.parse(extractJsonObject(responseText));

    return {
      provider: "gemini" as const,
      draft: sanitizeGeminiDraft(parsed, fallback),
      error: null,
    };
  } catch (error) {
    return {
      provider: "heuristic" as const,
      draft: fallback,
      error: error instanceof Error ? error.message : "Gemini analysis failed.",
    };
  }
}

export const analyzeClip = actionGeneric({
  args: {
    payload: analyzePayloadValidator,
  },
  handler: async (_ctx, args) => {
    const payload = args.payload as AnalyzePayload;
    const fallbackDraft = createAnalysisDraft(payload);
    const generated = await generateGeminiDraft(payload, fallbackDraft);

    return {
      accepted: generated.draft.accepted,
      mode: generated.draft.mode,
      confidence: generated.draft.confidence,
      summary: generated.draft.summary,
      nextStep: generated.draft.nextStep,
      provider: generated.provider,
      geminiError: generated.error,
      draft: generated.draft,
      fallbackDraft,
      payload,
    } satisfies AnalysisRunResult;
  },
});
