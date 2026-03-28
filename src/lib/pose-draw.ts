import { POSE_CONNECTIONS, getLandmark, isLandmarkVisible, type PoseLandmarkPoint } from "@/lib/pose";

function resizeCanvas(canvas: HTMLCanvasElement) {
  const parent = canvas.parentElement;

  if (!parent) {
    return { width: canvas.width, height: canvas.height };
  }

  const rect = parent.getBoundingClientRect();
  const devicePixelRatio = window.devicePixelRatio || 1;
  const displayWidth = Math.max(1, Math.round(rect.width));
  const displayHeight = Math.max(1, Math.round(rect.height));
  const nextWidth = Math.round(displayWidth * devicePixelRatio);
  const nextHeight = Math.round(displayHeight * devicePixelRatio);

  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
  }

  return { width: displayWidth, height: displayHeight };
}

export function drawPoseOverlay(canvas: HTMLCanvasElement, landmarks: PoseLandmarkPoint[]) {
  const { width, height } = resizeCanvas(canvas);
  const context = canvas.getContext("2d");

  if (!context) {
    return;
  }

  const pixelRatio = window.devicePixelRatio || 1;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  if (landmarks.length === 0) {
    return;
  }

  context.lineCap = "round";
  context.lineJoin = "round";

  for (const [startIndex, endIndex] of POSE_CONNECTIONS) {
    const start = getLandmark(landmarks, startIndex);
    const end = getLandmark(landmarks, endIndex);

    if (!start || !end || !isLandmarkVisible(start, 0.35) || !isLandmarkVisible(end, 0.35)) {
      continue;
    }

    context.strokeStyle = "rgba(107, 214, 255, 0.9)";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(start.x * width, start.y * height);
    context.lineTo(end.x * width, end.y * height);
    context.stroke();
  }

  for (const landmark of landmarks) {
    if (!isLandmarkVisible(landmark, 0.35)) {
      continue;
    }

    context.fillStyle = landmark.visibility >= 0.7 ? "#ffffff" : "rgba(255, 255, 255, 0.6)";
    context.beginPath();
    context.arc(landmark.x * width, landmark.y * height, 4, 0, Math.PI * 2);
    context.fill();
  }
}
