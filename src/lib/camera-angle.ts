import {
  POSE_LANDMARK_INDEX,
  distance2d,
  getLandmark,
  isLandmarkVisible,
  type PoseLandmarkPoint,
} from "@/lib/pose";

export type CameraAngleAssessment = {
  label: "sagittal" | "coronal" | "angled" | "unknown";
  confidence: number;
  widthRatio: number | null;
  depthRatio: number | null;
  guidance: string;
};

function round(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}

export function detectCameraAngle(landmarks: PoseLandmarkPoint[]): CameraAngleAssessment {
  const leftShoulder = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftShoulder);
  const rightShoulder = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightShoulder);
  const leftHip = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftHip);
  const rightHip = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightHip);

  if (
    !leftShoulder ||
    !rightShoulder ||
    !leftHip ||
    !rightHip ||
    !isLandmarkVisible(leftShoulder) ||
    !isLandmarkVisible(rightShoulder) ||
    !isLandmarkVisible(leftHip) ||
    !isLandmarkVisible(rightHip)
  ) {
    return {
      label: "unknown",
      confidence: 0,
      widthRatio: null,
      depthRatio: null,
      guidance: "Keep shoulders and hips visible to estimate camera angle.",
    };
  }

  const torsoHeight = (distance2d(leftShoulder, leftHip) + distance2d(rightShoulder, rightHip)) / 2;

  if (torsoHeight === 0) {
    return {
      label: "unknown",
      confidence: 0,
      widthRatio: null,
      depthRatio: null,
      guidance: "Unable to read torso geometry from the current frame.",
    };
  }

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const hipWidth = Math.abs(leftHip.x - rightHip.x);
  const widthRatio = ((shoulderWidth + hipWidth) / 2) / torsoHeight;
  const shoulderDepth = Math.abs(leftShoulder.z - rightShoulder.z);
  const hipDepth = Math.abs(leftHip.z - rightHip.z);
  const depthRatio = ((shoulderDepth + hipDepth) / 2) / torsoHeight;

  if (widthRatio <= 0.38 && depthRatio >= 0.32) {
    return {
      label: "sagittal",
      confidence: Math.min(1, 0.55 + depthRatio),
      widthRatio: round(widthRatio),
      depthRatio: round(depthRatio),
      guidance: "Good side-view setup for squat and hinge scoring.",
    };
  }

  if (widthRatio >= 0.7 && depthRatio <= 0.18) {
    return {
      label: "coronal",
      confidence: Math.min(1, 0.45 + widthRatio / 2),
      widthRatio: round(widthRatio),
      depthRatio: round(depthRatio),
      guidance: "Front-on view is readable. Use sagittal for the primary demo analysis path.",
    };
  }

  return {
    label: "angled",
    confidence: 0.62,
    widthRatio: round(widthRatio),
    depthRatio: round(depthRatio),
    guidance: "Rotate the camera toward a full side or full front view for more reliable biomechanics.",
  };
}
