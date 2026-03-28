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
  guidance: string;
  issues: string[];
  visibleLandmarks: number;
  fullBodyVisible: boolean;
  centered: boolean;
  clipped: boolean;
};

export function getLandmark(
  landmarks: PoseLandmarkPoint[],
  index: number,
): PoseLandmarkPoint | null {
  return landmarks[index] ?? null;
}

export function isLandmarkVisible(
  landmark: PoseLandmarkPoint | null,
  minimumVisibility = 0.45,
) {
  return Boolean(landmark && (landmark.visibility ?? 0) >= minimumVisibility);
}

export function countVisibleLandmarks(
  landmarks: PoseLandmarkPoint[],
  minimumVisibility = 0.45,
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

export function evaluateFrameQuality(landmarks: PoseLandmarkPoint[]): PoseFrameQuality {
  if (landmarks.length === 0) {
    return {
      readiness: "blocked",
      guidance: "Start the camera and step into frame so the live pose pipeline can lock on.",
      issues: [],
      visibleLandmarks: 0,
      fullBodyVisible: false,
      centered: false,
      clipped: false,
    };
  }

  const visibleLandmarks = countVisibleLandmarks(landmarks, 0.45);
  const shoulders = [
    getLandmark(landmarks, POSE_LANDMARK_INDEX.leftShoulder),
    getLandmark(landmarks, POSE_LANDMARK_INDEX.rightShoulder),
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

  const requiredForTracking = [...shoulders, ...hips].every((landmark) => isLandmarkVisible(landmark));
  const lowerBodyVisible = [...knees, ...ankles].filter((landmark) => isLandmarkVisible(landmark)).length >= 3;
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
  const fullBodyVisible = requiredForTracking && lowerBodyVisible && !clipped;
  const issues: string[] = [];

  if (visibleLandmarks < 10) {
    issues.push("Need a clearer pose lock.");
  }

  if (!requiredForTracking) {
    issues.push("Keep shoulders and hips visible.");
  }

  if (!lowerBodyVisible) {
    issues.push("Step back until knees and ankles stay in frame.");
  }

  if (clipped) {
    issues.push("Body is clipping the frame edge.");
  }

  if (!centered && visiblePoints.length > 0) {
    issues.push("Center your body in the preview.");
  }

  if (!requiredForTracking || visibleLandmarks < 10) {
    return {
      readiness: "blocked",
      guidance: "Move into better light and keep your torso fully visible so the pose tracker can lock on.",
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
      guidance: "You are close. Step back slightly and keep your whole lower body inside the frame.",
      issues,
      visibleLandmarks,
      fullBodyVisible,
      centered,
      clipped,
    };
  }

  return {
    readiness: "ready",
    guidance: "Frame looks usable for live squat and hinge diagnostics.",
    issues,
    visibleLandmarks,
    fullBodyVisible,
    centered,
    clipped,
  };
}
