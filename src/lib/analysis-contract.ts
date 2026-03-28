export type AnalyzeInputSource = "camera" | "clip" | null;

export type AnalyzeDecision = "full" | "best_effort" | "reject";

export type AnalyzeConfidence = "high" | "medium" | "low";

export type AnalyzePayload = {
  sourceType: AnalyzeInputSource;
  clipName: string | null;
  decision: AnalyzeDecision;
  recommendation: string;
  confidence: AnalyzeConfidence;
  cameraAngle: {
    label: "sagittal" | "coronal" | "angled" | "unknown";
    confidence: number;
  };
  frameStats: {
    sampledFrames: number;
    fullFrames: number;
    bestEffortFrames: number;
    rejectedFrames: number;
    averageVisibleLandmarks: number;
    latestVisibleLandmarks: number;
    captureWindowMs: number;
  };
  quality: {
    currentReadiness: "ready" | "adjusting" | "blocked";
    currentReason: string;
    currentIssues: string[];
    windowIssues: string[];
  };
  motionSummary: {
    dominantSide: "left" | "right" | null;
    trunkLean: number | null;
    leftKnee: number | null;
    rightKnee: number | null;
    leftHip: number | null;
    rightHip: number | null;
  };
  geminiInstructions: string[];
};
