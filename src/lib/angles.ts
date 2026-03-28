import {
  POSE_LANDMARK_INDEX,
  distance2d,
  getLandmark,
  isLandmarkVisible,
  midpoint,
  type PoseLandmarkPoint,
} from "@/lib/pose";

export type AngleMetric = {
  label: string;
  value: number | null;
  unit: "deg";
};

export type LiveAngles = {
  leftKnee: number | null;
  rightKnee: number | null;
  leftHip: number | null;
  rightHip: number | null;
  leftAnkle: number | null;
  rightAnkle: number | null;
  trunkLean: number | null;
  dominantSide: "left" | "right" | null;
  primaryKnee: number | null;
  primaryHip: number | null;
  primaryAnkle: number | null;
  metrics: AngleMetric[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

export function calculateAngle(
  pointA: PoseLandmarkPoint | null,
  pointB: PoseLandmarkPoint | null,
  pointC: PoseLandmarkPoint | null,
) {
  if (!pointA || !pointB || !pointC) {
    return null;
  }

  if (!isLandmarkVisible(pointA) || !isLandmarkVisible(pointB) || !isLandmarkVisible(pointC)) {
    return null;
  }

  const vectorAB = {
    x: pointA.x - pointB.x,
    y: pointA.y - pointB.y,
  };
  const vectorCB = {
    x: pointC.x - pointB.x,
    y: pointC.y - pointB.y,
  };

  const magnitudeAB = Math.hypot(vectorAB.x, vectorAB.y);
  const magnitudeCB = Math.hypot(vectorCB.x, vectorCB.y);

  if (magnitudeAB === 0 || magnitudeCB === 0) {
    return null;
  }

  const cosine = clamp(
    (vectorAB.x * vectorCB.x + vectorAB.y * vectorCB.y) / (magnitudeAB * magnitudeCB),
    -1,
    1,
  );

  return round((Math.acos(cosine) * 180) / Math.PI);
}

function calculateSegmentLean(
  shoulder: PoseLandmarkPoint | null,
  hip: PoseLandmarkPoint | null,
) {
  if (!shoulder || !hip || !isLandmarkVisible(shoulder) || !isLandmarkVisible(hip)) {
    return null;
  }

  const torsoLength = distance2d(shoulder, hip);

  if (torsoLength === 0) {
    return null;
  }

  const dx = shoulder.x - hip.x;
  const dy = hip.y - shoulder.y;
  return round((Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI);
}

function calculateTrunkLean(landmarks: PoseLandmarkPoint[]) {
  const leftShoulder = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftShoulder);
  const rightShoulder = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightShoulder);
  const leftHip = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftHip);
  const rightHip = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightHip);

  const canUseMidpoint =
    leftShoulder &&
    rightShoulder &&
    leftHip &&
    rightHip &&
    isLandmarkVisible(leftShoulder) &&
    isLandmarkVisible(rightShoulder) &&
    isLandmarkVisible(leftHip) &&
    isLandmarkVisible(rightHip);

  if (canUseMidpoint && leftShoulder && rightShoulder && leftHip && rightHip) {
    const shoulderMid = midpoint(leftShoulder, rightShoulder);
    const hipMid = midpoint(leftHip, rightHip);
    return calculateSegmentLean(shoulderMid, hipMid);
  }

  const preferredSide = dominantSide(landmarks);

  if (preferredSide === "right") {
    return calculateSegmentLean(rightShoulder, rightHip) ?? calculateSegmentLean(leftShoulder, leftHip);
  }

  return calculateSegmentLean(leftShoulder, leftHip) ?? calculateSegmentLean(rightShoulder, rightHip);
}

function dominantSide(landmarks: PoseLandmarkPoint[]): "left" | "right" | null {
  const leftIndexes = [
    POSE_LANDMARK_INDEX.leftShoulder,
    POSE_LANDMARK_INDEX.leftHip,
    POSE_LANDMARK_INDEX.leftKnee,
    POSE_LANDMARK_INDEX.leftAnkle,
  ];
  const rightIndexes = [
    POSE_LANDMARK_INDEX.rightShoulder,
    POSE_LANDMARK_INDEX.rightHip,
    POSE_LANDMARK_INDEX.rightKnee,
    POSE_LANDMARK_INDEX.rightAnkle,
  ];

  const leftScore = leftIndexes.reduce((sum, index) => sum + (getLandmark(landmarks, index)?.visibility ?? 0), 0);
  const rightScore = rightIndexes.reduce((sum, index) => sum + (getLandmark(landmarks, index)?.visibility ?? 0), 0);

  if (leftScore === 0 && rightScore === 0) {
    return null;
  }

  return leftScore >= rightScore ? "left" : "right";
}

export function getLiveAngles(landmarks: PoseLandmarkPoint[]): LiveAngles {
  const leftShoulder = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftShoulder);
  const rightShoulder = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightShoulder);
  const leftHip = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftHip);
  const rightHip = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightHip);
  const leftKnee = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftKnee);
  const rightKnee = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightKnee);
  const leftAnkle = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftAnkle);
  const rightAnkle = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightAnkle);
  const leftFootIndex = getLandmark(landmarks, POSE_LANDMARK_INDEX.leftFootIndex);
  const rightFootIndex = getLandmark(landmarks, POSE_LANDMARK_INDEX.rightFootIndex);

  const liveAngles = {
    leftKnee: calculateAngle(leftHip, leftKnee, leftAnkle),
    rightKnee: calculateAngle(rightHip, rightKnee, rightAnkle),
    leftHip: calculateAngle(leftShoulder, leftHip, leftKnee),
    rightHip: calculateAngle(rightShoulder, rightHip, rightKnee),
    leftAnkle: calculateAngle(leftKnee, leftAnkle, leftFootIndex),
    rightAnkle: calculateAngle(rightKnee, rightAnkle, rightFootIndex),
    trunkLean: calculateTrunkLean(landmarks),
    dominantSide: dominantSide(landmarks),
  } as const;

  const primarySide = liveAngles.dominantSide === "right" ? "right" : "left";
  const primaryKnee = primarySide === "right" ? liveAngles.rightKnee : liveAngles.leftKnee;
  const primaryHip = primarySide === "right" ? liveAngles.rightHip : liveAngles.leftHip;
  const primaryAnkle = primarySide === "right" ? liveAngles.rightAnkle : liveAngles.leftAnkle;

  return {
    ...liveAngles,
    primaryKnee,
    primaryHip,
    primaryAnkle,
    metrics: [
      { label: "Trunk lean", value: liveAngles.trunkLean, unit: "deg" },
      { label: "Primary hip", value: primaryHip, unit: "deg" },
      { label: "Primary knee", value: primaryKnee, unit: "deg" },
      { label: "Left knee", value: liveAngles.leftKnee, unit: "deg" },
      { label: "Right knee", value: liveAngles.rightKnee, unit: "deg" },
      { label: "Left hip", value: liveAngles.leftHip, unit: "deg" },
      { label: "Right hip", value: liveAngles.rightHip, unit: "deg" },
    ],
  };
}
