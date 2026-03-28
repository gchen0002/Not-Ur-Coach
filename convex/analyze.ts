import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import type { AnalyzePayload } from "../src/lib/analysis-contract";
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
  geminiInstructions: v.array(v.string()),
});

export const analyzeClip = actionGeneric({
  args: {
    payload: analyzePayloadValidator,
  },
  handler: async (_ctx, args) => {
    const payload = args.payload as AnalyzePayload;
    const draft = createAnalysisDraft(payload);

    return {
      accepted: draft.accepted,
      mode: draft.mode,
      confidence: draft.confidence,
      summary: draft.summary,
      nextStep: draft.nextStep,
      draft,
      payload,
    };
  },
});
