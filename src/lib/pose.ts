import { resolveExerciseMovementProfile } from "@/lib/exercise-profile";

export type PoseLandmarkPoint = {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence: number;
};

export const POSE_LANDMARK_INDEX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const;

export const POSE_CONNECTIONS: Array<[number, number]> = [
  [POSE_LANDMARK_INDEX.leftShoulder, POSE_LANDMARK_INDEX.rightShoulder],
  [POSE_LANDMARK_INDEX.leftShoulder, POSE_LANDMARK_INDEX.leftElbow],
  [POSE_LANDMARK_INDEX.leftElbow, POSE_LANDMARK_INDEX.leftWrist],
  [POSE_LANDMARK_INDEX.rightShoulder, POSE_LANDMARK_INDEX.rightElbow],
  [POSE_LANDMARK_INDEX.rightElbow, POSE_LANDMARK_INDEX.rightWrist],
  [POSE_LANDMARK_INDEX.leftShoulder, POSE_LANDMARK_INDEX.leftHip],
  [POSE_LANDMARK_INDEX.rightShoulder, POSE_LANDMARK_INDEX.rightHip],
  [POSE_LANDMARK_INDEX.leftHip, POSE_LANDMARK_INDEX.rightHip],
  [POSE_LANDMARK_INDEX.leftHip, POSE_LANDMARK_INDEX.leftKnee],
  [POSE_LANDMARK_INDEX.leftKnee, POSE_LANDMARK_INDEX.leftAnkle],
  [POSE_LANDMARK_INDEX.leftAnkle, POSE_LANDMARK_INDEX.leftHeel],
  [POSE_LANDMARK_INDEX.leftHeel, POSE_LANDMARK_INDEX.leftFootIndex],
  [POSE_LANDMARK_INDEX.rightHip, POSE_LANDMARK_INDEX.rightKnee],
  [POSE_LANDMARK_INDEX.rightKnee, POSE_LANDMARK_INDEX.rightAnkle],
  [POSE_LANDMARK_INDEX.rightAnkle, POSE_LANDMARK_INDEX.rightHeel],
  [POSE_LANDMARK_INDEX.rightHeel, POSE_LANDMARK_INDEX.rightFootIndex],
];

export type PoseFrameQuality = {
  readiness: "ready" | "adjusting" | "blocked";
  analysisReadiness: "full" | "best_effort" | "reject";
  analysisReason: string;
  guidance: string;
  issues: string[];
  visibleLandmarks: number;
  fullBodyVisible: boolean;
  centered: boolean;
  clipped: boolean;
};

export type PoseWindowQuality = {
  analysisReadiness: "full" | "best_effort" | "reject";
  recommendation: string;
  sampledFrames: number;
  fullFrames: number;
  bestEffortFrames: number;
  rejectedFrames: number;
  primaryIssues: string[];
};

export type PoseQualityOptions = {
  exerciseName?: string | null;
};

export function getLandmark(
  landmarks: PoseLandmarkPoint[],
  index: number,
): PoseLandmarkPoint | null {
  return landmarks[index] ?? null;
}

export function isLandmarkVisible(
  landmark: PoseLandmarkPoint | null,
  minimumVisibility = 0.35,
) {
  return Boolean(landmark && (landmark.visibility ?? 0) >= minimumVisibility);
}

export function countVisibleLandmarks(
  landmarks: PoseLandmarkPoint[],
  minimumVisibility = 0.35,
) {
  return landmarks.filter((landmark) => isLandmarkVisible(landmark, minimumVisibility)).length;
}

export function midpoint(a: PoseLandmarkPoint, b: PoseLandmarkPoint): PoseLandmarkPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
    presence: Math.min(a.presence, b.presence),
  };
}

export function distance2d(a: PoseLandmarkPoint, b: PoseLandmarkPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function evaluateFrameQuality(
  landmarks: PoseLandmarkPoint[],
  options?: PoseQualityOptions,
): PoseFrameQuality {
  const exerciseProfile = resolveExerciseMovementProfile(options?.exerciseName);

  if (landmarks.length === 0) {
    return {
      readiness: "blocked",
      analysisReadiness: "reject",
      analysisReason: "No usable pose detected yet.",
      guidance: exerciseProfile.setupGuidance,
      issues: [],
      visibleLandmarks: 0,
      fullBodyVisible: false,
      centered: false,
      clipped: false,
    };
  }

  const visibleLandmarks = countVisibleLandmarks(landmarks, 0.35);
  const shoulders = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftShoulder),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightShoulder),
  ];
  const elbows = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftElbow),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightElbow),
  ];
  const wrists = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftWrist),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightWrist),
  ];
  const hips = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftHip),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightHip),
  ];
  const knees = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftKnee),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightKnee),
  ];
  const ankles = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftAnkle),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightAnkle),
  ];

  const visibleShoulders = shoulders.filter((landmark) => isLandmarkVisible(landmark)).length;
  const visibleElbows = elbows.filter((landmark) => isLandmarkVisible(landmark)).length;
  const visibleWrists = wrists.filter((landmark) => isLandmarkVisible(landmark)).length;
  const visibleHips = hips.filter((landmark) => isLandmarkVisible(landmark)).length;
  const leftUpperChainVisible = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftShoulder),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftElbow),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftWrist),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftHip),
  ].every((landmark) => isLandmarkVisible(landmark));
  const rightUpperChainVisible = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightShoulder),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightElbow),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightWrist),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightHip),
  ].every((landmark) => isLandmarkVisible(landmark));
  const leftSideChainVisible = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftShoulder),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftHip),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftKnee),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftAnkle),
  ].every((landmark) => isLandmarkVisible(landmark));
  const rightSideChainVisible = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightShoulder),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightHip),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightKnee),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightAnkle),
  ].every((landmark) => isLandmarkVisible(landmark));
  const lowerBodyVisible = [...knees, ...ankles].filter((landmark) => isLandmarkVisible(landmark)).length >= 3;
  const torsoVisible = visibleShoulders >= 1 && visibleHips >= 1;
  const upperBodyVisible = torsoVisible && (leftUpperChainVisible || rightUpperChainVisible || (visibleElbows + visibleWrists) >= 2);
  const minVisibleForLock = exerciseProfile.pattern === "upper" ? 8 : 10;
  const minVisibleForReject = exerciseProfile.pattern === "upper" ? 6 : 8;
  const minVisibleForFull = exerciseProfile.pattern === "upper" ? 12 : 16;
  const requiredForTracking = exerciseProfile.pattern === "upper"
    ? upperBodyVisible
    : exerciseProfile.prefersSingleSide
      ? torsoVisible && (leftSideChainVisible || rightSideChainVisible || lowerBodyVisible)
      : visibleShoulders === 2 && visibleHips === 2;
  const visiblePoints = landmarks.filter((landmark) => isLandmarkVisible(landmark)).map((landmark) => ({
    x: landmark.x,
    y: landmark.y,
  }));

  const clipped = visiblePoints.some((point) =>
    point.x <= 0.03 || point.x >= 0.97 || point.y <= 0.03 || point.y >= 0.97,
  );
  const centered = visiblePoints.length > 0
    ? visiblePoints.every((point) => point.x >= 0.08 && point.x <= 0.92)
    : false;
  const fullBodyVisible = exerciseProfile.pattern === "upper"
    ? requiredForTracking && !clipped
    : exerciseProfile.prefersSingleSide
      ? requiredForTracking && (leftSideChainVisible || rightSideChainVisible || lowerBodyVisible) && !clipped
      : requiredForTracking && lowerBodyVisible && !clipped;
  const severeCrop = clipped && (exerciseProfile.pattern === "upper" ? !upperBodyVisible : !lowerBodyVisible);
  const issues: string[] = [];

  let analysisReadiness: PoseFrameQuality["analysisReadiness"] = "full";
  let analysisReason = "Enough body visibility for standard scoring and Gemini analysis.";

  if (visibleLandmarks < minVisibleForLock) {
    issues.push("Need a clearer pose lock.");
  }

  if (!requiredForTracking) {
    issues.push(exerciseProfile.pattern === "upper"
      ? "Keep the shoulders, torso, and at least one working arm visible, even if the legs are cropped."
      : exerciseProfile.prefersSingleSide
        ? "Keep one shoulder-to-ankle side chain visible, even if the face is cropped."
        : "Keep shoulders and hips visible, even if the face is cropped.");
  }

  if (exerciseProfile.pattern !== "upper" && !lowerBodyVisible) {
    issues.push(exerciseProfile.pattern === "hinge"
      ? "Step back until one full shoulder-to-ankle side stays visible through the hinge."
      : "Step back until knees and ankles stay in frame.");
  }

  if (clipped) {
    issues.push("Body is clipping the frame edge.");
  }

  if (!centered && visiblePoints.length > 0) {
    issues.push("Center your body in the preview.");
  }

  if (visibleLandmarks < minVisibleForReject || !requiredForTracking || severeCrop) {
    analysisReadiness = "reject";
    analysisReason =
      exerciseProfile.pattern === "upper"
        ? "Too much of the torso or working arm is missing for a trustworthy upper-body analysis."
        : exerciseProfile.pattern === "hinge"
        ? "Too much of the main shoulder-hip-knee-ankle chain is missing for a trustworthy hinge analysis."
        : "Too much of the torso or lower body is missing for a trustworthy analysis.";
  } else if (!fullBodyVisible || visibleLandmarks < minVisibleForFull || !centered) {
    analysisReadiness = "best_effort";
    analysisReason =
      "Usable for a best-effort Gemini read, but expect lower confidence because the clip is cropped or partially occluded.";
  }

  if (!requiredForTracking || visibleLandmarks < minVisibleForLock) {
    return {
      readiness: "blocked",
      analysisReadiness,
      analysisReason,
      guidance: exerciseProfile.pattern === "upper"
        ? "Move into better light and keep the torso plus one full working arm visible so the pose tracker can lock on."
        : exerciseProfile.prefersSingleSide
          ? "Move into better light and keep one full shoulder-to-ankle side chain visible so the pose tracker can lock on."
          : "Move into better light and keep shoulders, hips, and legs visible so the pose tracker can lock on.",
      issues,
      visibleLandmarks,
      fullBodyVisible,
      centered,
      clipped,
    };
  }

  if (!fullBodyVisible) {
    return {
      readiness: "adjusting",
      analysisReadiness,
      analysisReason,
      guidance: exerciseProfile.pattern === "upper"
        ? "You are close. Keep the torso and working arm inside the frame and avoid clipping the elbows or wrists."
        : exerciseProfile.pattern === "hinge"
          ? "You are close. Step back slightly and keep the main shoulder-to-ankle side chain visible through the full hinge."
          : "You are close. Step back slightly and keep shoulders through feet inside the frame.",
      issues,
      visibleLandmarks,
      fullBodyVisible,
      centered,
      clipped,
    };
  }

  return {
    readiness: "ready",
    analysisReadiness,
    analysisReason,
    guidance: exerciseProfile.setupGuidance,
    issues,
    visibleLandmarks,
    fullBodyVisible,
    centered,
    clipped,
  };
}

export function summarizePoseWindow(qualities: PoseFrameQuality[]): PoseWindowQuality {
  if (qualities.length === 0) {
    return {
      analysisReadiness: "reject",
      recommendation: "Collect a few usable frames before deciding whether this clip should go to Gemini.",
      sampledFrames: 0,
      fullFrames: 0,
      bestEffortFrames: 0,
      rejectedFrames: 0,
      primaryIssues: [],
    };
  }

  const fullFrames = qualities.filter((quality) => quality.analysisReadiness === "full").length;
  const bestEffortFrames = qualities.filter((quality) => quality.analysisReadiness === "best_effort").length;
  const rejectedFrames = qualities.length - fullFrames - bestEffortFrames;

  const issueCounts = new Map<string, number>();
  for (const quality of qualities) {
    for (const issue of quality.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    }
  }

  const primaryIssues = [...issueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([issue]) => issue);

  if (fullFrames >= Math.max(3, Math.ceil(qualities.length * 0.45))) {
    return {
      analysisReadiness: "full",
      recommendation: "Good enough for standard scoring. Most recent frames have enough body visibility for normal analysis.",
      sampledFrames: qualities.length,
      fullFrames,
      bestEffortFrames,
      rejectedFrames,
      primaryIssues,
    };
  }

  if (fullFrames + bestEffortFrames >= Math.max(3, Math.ceil(qualities.length * 0.55))) {
    return {
      analysisReadiness: "best_effort",
      recommendation: "Run Gemini in best-effort mode. Enough frames are usable, but the analysis should carry lower confidence and crop warnings.",
      sampledFrames: qualities.length,
      fullFrames,
      bestEffortFrames,
      rejectedFrames,
      primaryIssues,
    };
  }

  return {
    analysisReadiness: "reject",
    recommendation: "Reject this clip for analysis. Too many frames are cropped or missing critical joints to trust the output.",
    sampledFrames: qualities.length,
    fullFrames,
    bestEffortFrames,
    rejectedFrames,
    primaryIssues,
  };
}
