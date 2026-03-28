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

export type AnalysisCue = {
  cue: string;
  priority: "high" | "medium" | "low";
};

export type AnalysisScores = {
  overall: number | null;
  rom: number | null;
  tensionProfile: number | null;
  tempo: number | null;
  symmetry: number | null;
  fatigueManagement: number | null;
};

export type AnalysisDraft = {
  accepted: boolean;
  mode: AnalyzeDecision;
  confidence: AnalyzeConfidence;
  summary: string;
  basicAnalysis: {
    summary: string;
    whatYoureDoingWell: string[];
    whatToFix: string[];
  };
  scores: AnalysisScores;
  cues: AnalysisCue[];
  risks: string[];
  nextStep: string;
};
