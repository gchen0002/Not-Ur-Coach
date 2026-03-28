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
  repStats: {
    detectedRepCount: number;
    averageRepDurationMs: number | null;
    averageBottomKneeAngle: number | null;
    primaryMetric: "knee_flexion";
  };
  reps: Array<{
    repNumber: number;
    startMs: number;
    bottomMs: number;
    endMs: number;
    durationMs: number;
    bottomKneeAngle: number | null;
    confidence: "high" | "medium" | "low";
  }>;
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

export type AnalysisRunResult = {
  accepted: boolean;
  mode: AnalyzeDecision;
  confidence: AnalyzeConfidence;
  summary: string;
  nextStep: string;
  provider: "gemini" | "heuristic" | "local";
  geminiError: string | null;
  draft: AnalysisDraft;
  fallbackDraft: AnalysisDraft;
  payload: AnalyzePayload;
};

export type CompactAnalysisEvidence = {
  tier: "exercise" | "movement_family" | "heuristic";
  finding: string;
  source: string;
};

export type CompactAnalysisInput = {
  exercise: string;
  targetMuscles: string[];
  sessionIntent: "form_check" | "work_set" | "demo";
  resistanceType: "bodyweight" | "free_weight" | "machine" | "unknown";
  cameraAngle: "sagittal" | "coronal" | "angled" | "unknown";
  clipQuality: {
    confidence: AnalyzeConfidence;
    visibleJointConfidence: AnalyzeConfidence;
    issues: string[];
    occlusionNotes: string[];
  };
  repSummary: {
    repCount: number | null;
    avgRepDurationMs: number | null;
    phaseNotes: string[];
  };
  poseSummary: {
    dominantSide: "left" | "right" | null;
    trunkLean: number | null;
    hipPatternNote: string | null;
    kneePatternNote: string | null;
  };
  evidence: CompactAnalysisEvidence[];
  recentHistory: Array<{
    summary: string;
    overallScore?: number | null;
  }>;
};

export type LivePromptBudget = {
  sessionOpenContext: {
    exercise: string;
    targetMuscles: string[];
    coachingStyle: string;
    guardrails: string[];
  };
  deltaPacket: {
    phase: "setup" | "descent" | "stretch" | "ascent" | "lockout" | "unknown";
    repCount: number | null;
    confidence: AnalyzeConfidence;
    notes: string[];
  };
};

export type AnalysisHistoryEntry = {
  id: string;
  createdAt: number;
  provider: AnalysisRunResult["provider"];
  sourceType: AnalyzeInputSource;
  clipName: string | null;
  mode: AnalyzeDecision;
  confidence: AnalyzeConfidence;
  overallScore: number | null;
  repCount: number;
  averageRepDurationMs: number | null;
  averageBottomKneeAngle: number | null;
  cameraAngle: AnalyzePayload["cameraAngle"]["label"];
  summary: string;
  cues: string[];
};
