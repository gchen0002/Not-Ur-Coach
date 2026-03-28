import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { AnalysisDraft, AnalysisRunResult, AnalyzePayload, CompactAnalysisInput } from "../src/lib/analysis-contract";
import { createAnalysisDraft } from "../src/lib/analysis-draft";

const ANALYSIS_MODEL = "gemini-3-flash-preview";

const analyzePayloadValidator = v.object({
  sourceType: v.union(v.literal("camera"), v.literal("clip"), v.null()),
  clipName: v.union(v.string(), v.null()),
  userContext: v.object({
    exerciseName: v.union(v.string(), v.null()),
    targetMuscles: v.array(v.string()),
    sessionIntent: v.union(v.literal("form_check"), v.literal("work_set"), v.literal("demo")),
    resistanceType: v.union(
      v.literal("bodyweight"),
      v.literal("free_weight"),
      v.literal("machine"),
      v.literal("unknown"),
    ),
    notes: v.union(v.string(), v.null()),
  }),
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
    primaryKnee: v.union(v.number(), v.null()),
    primaryHip: v.union(v.number(), v.null()),
    leftKnee: v.union(v.number(), v.null()),
    rightKnee: v.union(v.number(), v.null()),
    leftHip: v.union(v.number(), v.null()),
    rightHip: v.union(v.number(), v.null()),
  }),
  repStats: v.object({
    detectedRepCount: v.number(),
    averageRepDurationMs: v.union(v.number(), v.null()),
    averageBottomKneeAngle: v.union(v.number(), v.null()),
    averageBottomPrimaryMetricValue: v.union(v.number(), v.null()),
    primaryMetric: v.union(v.literal("knee_flexion"), v.literal("hip_flexion")),
  }),
  reps: v.array(v.object({
    repNumber: v.number(),
    startMs: v.number(),
    bottomMs: v.number(),
    endMs: v.number(),
    durationMs: v.number(),
    bottomKneeAngle: v.union(v.number(), v.null()),
    bottomPrimaryMetricValue: v.union(v.number(), v.null()),
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
    nerdAnalysis: {
      summary:
        draft.nerdAnalysis && typeof draft.nerdAnalysis === "object" && typeof draft.nerdAnalysis.summary === "string" && draft.nerdAnalysis.summary.trim().length > 0
          ? draft.nerdAnalysis.summary.trim()
          : fallback.nerdAnalysis.summary,
      movementDiagnosis:
        draft.nerdAnalysis && Array.isArray(draft.nerdAnalysis.movementDiagnosis)
          ? draft.nerdAnalysis.movementDiagnosis.filter((item): item is string => typeof item === "string").slice(0, 4)
          : fallback.nerdAnalysis.movementDiagnosis,
      kinematicEvidence:
        draft.nerdAnalysis && Array.isArray(draft.nerdAnalysis.kinematicEvidence)
          ? draft.nerdAnalysis.kinematicEvidence.filter((item): item is string => typeof item === "string").slice(0, 4)
          : fallback.nerdAnalysis.kinematicEvidence,
      likelyConstraints:
        draft.nerdAnalysis && Array.isArray(draft.nerdAnalysis.likelyConstraints)
          ? draft.nerdAnalysis.likelyConstraints.filter((item): item is string => typeof item === "string").slice(0, 4)
          : fallback.nerdAnalysis.likelyConstraints,
      cueRationale:
        draft.nerdAnalysis && Array.isArray(draft.nerdAnalysis.cueRationale)
          ? draft.nerdAnalysis.cueRationale.filter((item): item is string => typeof item === "string").slice(0, 4)
          : fallback.nerdAnalysis.cueRationale,
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

function inferVisibleJointConfidence(payload: AnalyzePayload) {
  if (payload.frameStats.averageVisibleLandmarks >= 20 && payload.frameStats.rejectedFrames <= 1) {
    return "high" as const;
  }

  if (payload.frameStats.averageVisibleLandmarks >= 14) {
    return "medium" as const;
  }

  return "low" as const;
}

function inferPhaseNotes(payload: AnalyzePayload) {
  const notes = [] as string[];

  if (payload.repStats.detectedRepCount > 0) {
    notes.push(`${payload.repStats.detectedRepCount} provisional rep(s) detected.`);
  }

  if (payload.repStats.averageRepDurationMs !== null) {
    notes.push(`Average rep duration is about ${Math.round(payload.repStats.averageRepDurationMs)}ms.`);
  }

  if (payload.motionSummary.trunkLean !== null) {
    notes.push(`Trunk lean estimate: ${Math.round(payload.motionSummary.trunkLean)} degrees.`);
  }

  return notes.slice(0, 3);
}

function inferOcclusionNotes(payload: AnalyzePayload) {
  return [...payload.quality.currentIssues, ...payload.quality.windowIssues]
    .filter((issue) => /(clip|crop|occlud|frame edge|missing|visible)/i.test(issue))
    .slice(0, 2);
}

function inferHipPatternNote(payload: AnalyzePayload) {
  if (payload.motionSummary.leftHip === null && payload.motionSummary.rightHip === null) {
    return null;
  }

  const visibleHipAngles = [payload.motionSummary.leftHip, payload.motionSummary.rightHip].filter((value): value is number => value !== null);
  if (visibleHipAngles.length === 0) {
    return null;
  }

  const averageHipAngle = visibleHipAngles.reduce((sum, value) => sum + value, 0) / visibleHipAngles.length;
  return `Average visible hip angle is about ${Math.round(averageHipAngle)} degrees.`;
}

function inferKneePatternNote(payload: AnalyzePayload) {
  if (payload.repStats.averageBottomKneeAngle === null) {
    return null;
  }

  return `Bottom knee angle estimate is about ${Math.round(payload.repStats.averageBottomKneeAngle)} degrees.`;
}

function buildFallbackBaseline(fallback: AnalysisDraft) {
  return {
    mode: fallback.mode,
    confidence: fallback.confidence,
    summary: fallback.summary,
    scores: fallback.scores,
    whatYoureDoingWell: fallback.basicAnalysis.whatYoureDoingWell.slice(0, 3),
    whatToFix: fallback.basicAnalysis.whatToFix.slice(0, 2),
    cues: fallback.cues.slice(0, 2),
    nextStep: fallback.nextStep,
  };
}

function buildCompactAnalysisInput(
  payload: AnalyzePayload,
  context: CompactContext,
): CompactAnalysisInput {
  const clipName = payload.clipName?.replace(/\.[a-z0-9]+$/i, "") ?? "Unknown exercise";

  return {
    exercise: payload.userContext.exerciseName ?? context.exercise?.name ?? clipName,
    targetMuscles: payload.userContext.targetMuscles.length > 0
      ? payload.userContext.targetMuscles
      : context.exercise?.muscles ?? [],
    sessionIntent: payload.userContext.sessionIntent,
    resistanceType: payload.userContext.resistanceType !== "unknown"
      ? payload.userContext.resistanceType
      : context.exercise?.resistanceType ?? "unknown",
    userNotes: payload.userContext.notes,
    cameraAngle: payload.cameraAngle.label,
    clipQuality: {
      confidence: payload.confidence,
      visibleJointConfidence: inferVisibleJointConfidence(payload),
      issues: [...payload.quality.currentIssues, ...payload.quality.windowIssues].slice(0, 3),
      occlusionNotes: inferOcclusionNotes(payload),
    },
    repSummary: {
      repCount: payload.repStats.detectedRepCount,
      avgRepDurationMs: payload.repStats.averageRepDurationMs,
      phaseNotes: inferPhaseNotes(payload),
    },
    poseSummary: {
      dominantSide: payload.motionSummary.dominantSide,
      trunkLean: payload.motionSummary.trunkLean,
      hipPatternNote: inferHipPatternNote(payload),
      kneePatternNote: inferKneePatternNote(payload),
    },
    evidence: context.evidence.slice(0, 3),
    recentHistory: [],
  };
}

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
  evidence: Array<{
    tier: "exercise" | "movement_family" | "heuristic";
    finding: string;
    source: string;
  }>;
  guardrails: string[];
};

async function generateGeminiDraft(
  payload: AnalyzePayload,
  fallback: AnalysisDraft,
  context: CompactContext,
) {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

  if (!apiKey || payload.decision === "reject") {
    return {
      provider: "heuristic" as const,
      draft: fallback,
      error: payload.decision === "reject" ? null : "Missing GEMINI_API_KEY or GOOGLE_API_KEY.",
    };
  }

  try {
    const compactInput = buildCompactAnalysisInput(payload, context);
    const cleanHighConfidenceClip =
      payload.decision === "full"
      && payload.confidence === "high"
      && payload.frameStats.averageVisibleLandmarks >= 18
      && payload.quality.currentIssues.length === 0
      && payload.quality.windowIssues.length === 0;
    const upperBodyBias =
      context.exercise?.movementPattern === "upper"
      || /(row|pull|pulldown|curl|press|raise|bench|overhead)/i.test(compactInput.exercise);
    const repTelemetryLimited = upperBodyBias && cleanHighConfidenceClip && payload.repStats.detectedRepCount === 0;
    const compactRules = {
      scoring: [
        "Use provided evidence and app rules before generic fitness priors.",
        "Treat MediaPipe as support data, not absolute truth, especially when occlusion is present.",
        "Lower confidence when the clip is cropped, partially hidden, or the movement goal is not fully visible.",
        "When clip confidence is high and visibility is clean, be appropriately generous rather than grading like a problem clip.",
        "If the clip is strong, lead with 2-3 specific things the athlete is doing well before giving a main fix.",
        "Missing rep segmentation alone is not a form fault; treat it as telemetry limitation unless the visible motion itself is unclear.",
        "For upper-body lifts, reward stable torso position, repeatable setup, and clean pull or press mechanics when supported by the visible data.",
      ],
      outputBudget: {
        wellItemsMax: 3,
        fixItemsMax: 3,
        cuesMax: 4,
        risksMax: 3,
      },
    };
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
      nerdAnalysis: {
        summary: "",
        movementDiagnosis: [""],
        kinematicEvidence: [""],
        likelyConstraints: [""],
        cueRationale: [""],
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
    const fallbackBaseline = buildFallbackBaseline(fallback);
    const prompt = [
      "You are generating a concise biomechanics analysis draft for a fitness coaching app.",
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
      "- If mode is best_effort, mention crop, occlusion, or visibility limits in summary or basicAnalysis.summary.",
      "- Do not invent unseen joints, phases, or target-muscle claims beyond the provided evidence.",
      "- Prefer short, direct coaching language.",
      cleanHighConfidenceClip
        ? "- This is a high-confidence, visually clean clip. Start from the assumption that execution is solid unless clear evidence shows otherwise."
        : "",
      cleanHighConfidenceClip
        ? "- For a clean clip, avoid stingy scoring. A technically strong rep should read like a strong rep."
        : "",
      repTelemetryLimited
        ? "- Rep count is zero because segmentation was not stable, not because the user necessarily failed to show a real rep. Do not make rep start/end ambiguity the main fix unless it is visually obvious."
        : "",
      upperBodyBias
        ? "- This is an upper-body pattern. Prioritize torso stability, setup consistency, line of pull, and visible upper-back or lat mechanics over lower-body heuristics."
        : "",
      upperBodyBias
        ? "- If the visible mechanics look clean, include generous positive feedback in whatYoureDoingWell and keep the main fix modest."
        : "",
      `Compact analysis input: ${JSON.stringify(compactInput)}`,
      `Live/analysis guardrails: ${JSON.stringify(context.guardrails)}`,
      `App rules: ${JSON.stringify(compactRules)}`,
      `Support-only pose telemetry: ${JSON.stringify({
        decision: payload.decision,
        recommendation: payload.recommendation,
        geminiInstructions: payload.geminiInstructions.slice(0, 4),
      })}`,
      `Fallback baseline: ${JSON.stringify(fallbackBaseline)}`,
      "Stay faithful to the visible data, prioritize provided evidence, and avoid overclaiming on hidden joints.",
    ].join("\n\n");

    const response = await ai.models.generateContent({
      model: ANALYSIS_MODEL,
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
  handler: async (ctx, args) => {
    const payload = args.payload as AnalyzePayload;
    const fallbackDraft = createAnalysisDraft(payload);
    const contextRef = makeFunctionReference<"query", { clipName: string | null }, CompactContext>(
      "analysisContext:resolveCompactContext",
    );
    const context = await ctx.runQuery(contextRef, { clipName: payload.userContext.exerciseName ?? payload.clipName });
    const generated = await generateGeminiDraft(payload, fallbackDraft, context);

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
