import type { LiveAngles } from "@/lib/angles";
import type { CameraAngleAssessment } from "@/lib/camera-angle";
import type {
  AnalyzeConfidence,
  AnalyzeDecision,
  AnalyzeInputSource,
  AnalyzePayload,
} from "@/lib/analysis-contract";
import type { PoseFrameQuality, PoseWindowQuality, PoseLandmarkPoint } from "@/lib/pose";
import { summarizeReps } from "@/lib/reps";

export type BufferedPoseFrame = {
  detectedAt: number;
  visibleLandmarks: number;
  landmarks: PoseLandmarkPoint[];
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function getConfidence(decision: AnalyzeDecision): AnalyzeConfidence {
  if (decision === "full") {
    return "high";
  }

  if (decision === "best_effort") {
    return "medium";
  }

  return "low";
}

export function buildAnalyzePayload({
  sourceType,
  clipName,
  bufferedFrames,
  frameQuality,
  windowQuality,
  cameraAngle,
  liveAngles,
}: {
  sourceType: AnalyzeInputSource;
  clipName: string | null;
  bufferedFrames: BufferedPoseFrame[];
  frameQuality: PoseFrameQuality;
  windowQuality: PoseWindowQuality;
  cameraAngle: CameraAngleAssessment;
  liveAngles: LiveAngles;
}): AnalyzePayload {
  const sampledFrames = bufferedFrames.length;
  const repSummary = summarizeReps(bufferedFrames);
  const averageVisibleLandmarks =
    sampledFrames === 0
      ? 0
      : round(
          bufferedFrames.reduce((sum, frame) => sum + frame.visibleLandmarks, 0) / sampledFrames,
        );
  const captureWindowMs =
    sampledFrames >= 2
      ? bufferedFrames[sampledFrames - 1].detectedAt - bufferedFrames[0].detectedAt
      : 0;

  const geminiInstructions =
    windowQuality.analysisReadiness === "full"
      ? [
          "Use standard scoring and normal confidence language.",
          "Trust pose-derived joint metrics unless a specific segment drops out.",
        ]
      : windowQuality.analysisReadiness === "best_effort"
        ? [
            "Run best-effort analysis only.",
            "Call out cropping, occlusion, or missing joints explicitly.",
            "Lower confidence and avoid overclaiming on joints that are not visible.",
            repSummary.detectedRepCount > 0
              ? `You have ${repSummary.detectedRepCount} provisional reps from pose segmentation; use them carefully.`
              : "No clean reps were segmented, so rely on whole-clip motion patterns only.",
          ]
        : [
            "Reject this clip for analysis.",
            "Do not generate detailed form scoring.",
            "Return a concise explanation of why the clip is too incomplete to assess.",
          ];

  return {
    sourceType,
    clipName,
    decision: windowQuality.analysisReadiness,
    recommendation: windowQuality.recommendation,
    confidence: getConfidence(windowQuality.analysisReadiness),
    cameraAngle: {
      label: cameraAngle.label,
      confidence: round(cameraAngle.confidence * 100) / 100,
    },
    frameStats: {
      sampledFrames,
      fullFrames: windowQuality.fullFrames,
      bestEffortFrames: windowQuality.bestEffortFrames,
      rejectedFrames: windowQuality.rejectedFrames,
      averageVisibleLandmarks,
      latestVisibleLandmarks: frameQuality.visibleLandmarks,
      captureWindowMs,
    },
    quality: {
      currentReadiness: frameQuality.readiness,
      currentReason: frameQuality.analysisReason,
      currentIssues: frameQuality.issues,
      windowIssues: windowQuality.primaryIssues,
    },
    motionSummary: {
      dominantSide: liveAngles.dominantSide,
      trunkLean: liveAngles.trunkLean,
      leftKnee: liveAngles.leftKnee,
      rightKnee: liveAngles.rightKnee,
      leftHip: liveAngles.leftHip,
      rightHip: liveAngles.rightHip,
    },
    repStats: {
      detectedRepCount: repSummary.detectedRepCount,
      averageRepDurationMs: repSummary.averageRepDurationMs,
      averageBottomKneeAngle: repSummary.averageBottomKneeAngle,
      primaryMetric: repSummary.primaryMetric,
    },
    reps: repSummary.reps,
    geminiInstructions,
  };
}
