/// <reference lib="webworker" />
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import type { PoseLandmarkPoint } from "../lib/pose";

type WorkerGlobalWithImport = DedicatedWorkerGlobalScope & {
  import?: (url: string) => Promise<unknown>;
};

const workerGlobal = self as WorkerGlobalWithImport;
const workerScope = globalThis as typeof globalThis & {
  ModuleFactory?: unknown;
  dbg?: (...args: unknown[]) => void;
  custom_dbg?: (...args: unknown[]) => void;
};
const mediaPipeModuleCache = new Map<string, Promise<unknown>>();

function ensureMediaPipeDebugFallbacks() {
  if (typeof workerScope.custom_dbg !== "function") {
    workerScope.custom_dbg = (...args: unknown[]) => {
      console.warn(...args);
    };
  }

  if (typeof workerScope.dbg !== "function") {
    workerScope.dbg = workerScope.custom_dbg;
  }
}

async function importMediaPipeModule(url: string) {
  ensureMediaPipeDebugFallbacks();

  const rewrittenUrl = new URL(
    url
      .replace("vision_wasm_internal.js", "vision_wasm_module_internal.js")
      .replace("vision_wasm_nosimd_internal.js", "vision_wasm_module_internal.js"),
    self.location.href,
  ).href;

  if (!mediaPipeModuleCache.has(rewrittenUrl)) {
    mediaPipeModuleCache.set(rewrittenUrl, (async () => {
      try {
        const response = await fetch(rewrittenUrl);

        if (!response.ok) {
          throw new Error(`Failed to fetch MediaPipe runtime: ${response.status} ${response.statusText}`);
        }

        const source = await response.text();
        const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

        try {
          return await import(/* @vite-ignore */ blobUrl);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      } catch (error) {
        mediaPipeModuleCache.delete(rewrittenUrl);
        throw error;
      }
    })());
  }

  const imported = await mediaPipeModuleCache.get(rewrittenUrl)!;
  const moduleFactory = (imported as { default?: unknown; ModuleFactory?: unknown }).default
    ?? (imported as { ModuleFactory?: unknown }).ModuleFactory;

  if (moduleFactory) {
    workerScope.ModuleFactory = moduleFactory;
  }

  return imported;
}

if (typeof workerGlobal.import !== "function") {
  workerGlobal.import = async (url: string) => {
    return importMediaPipeModule(url);
  };
}

type SpikeMessage = {
  type: "RUN_SPIKE";
  requestId?: string;
  payload: {
    wasmPath: string;
    image: ImageBitmap;
  };
};

type InitMessage = {
  type: "INIT";
  requestId?: string;
  payload: {
    wasmPath: string;
    modelAssetPath: string;
    minPoseDetectionConfidence?: number;
    minPosePresenceConfidence?: number;
    minTrackingConfidence?: number;
  };
};

type DetectFrameMessage = {
  type: "DETECT_FRAME";
  requestId?: string;
  payload: {
    image: ImageBitmap;
    timestampMs: number;
  };
};

type WorkerMessage = SpikeMessage | InitMessage | DetectFrameMessage;

type SpikeResponse =
  | { requestId?: string; status: "success"; message: string; landmarks: number }
  | { requestId?: string; status: "error"; message: string };

type WorkerResponse =
  | SpikeResponse
  | { requestId?: string; status: "ready"; message: string }
  | {
      requestId?: string;
      status: "frame";
      message: string;
      landmarks: PoseLandmarkPoint[];
      visibleLandmarks: number;
      imageWidth: number;
      imageHeight: number;
      detectedAt: number;
    }
  | { status: "error"; message: string };

let landmarkerPromise: Promise<PoseLandmarker> | null = null;
let landmarkerConfigKey: string | null = null;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown MediaPipe worker error";
}

function normalizeLandmarks(result: PoseLandmarkerResult) {
  return (result.landmarks[0] ?? []).map((landmark) => ({
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility ?? 0,
    presence: 1,
  }));
}

async function getLandmarker(
  wasmPath: string,
  modelAssetPath: string,
  options?: {
    minPoseDetectionConfidence?: number;
    minPosePresenceConfidence?: number;
    minTrackingConfidence?: number;
  },
): Promise<PoseLandmarker> {
  const configKey = JSON.stringify({ wasmPath, modelAssetPath, ...options });

  if (!landmarkerPromise || landmarkerConfigKey !== configKey) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(wasmPath);
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
        },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: options?.minPoseDetectionConfidence,
        minPosePresenceConfidence: options?.minPosePresenceConfidence,
        minTrackingConfidence: options?.minTrackingConfidence,
      });
    })();
    landmarkerConfigKey = configKey;
  }

  return landmarkerPromise;
}

async function runSpike(wasmPath: string, image: ImageBitmap, requestId?: string): Promise<SpikeResponse> {
  try {
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "/mediapipe/pose_landmarker_lite.task",
      },
      runningMode: "IMAGE",
      numPoses: 1,
    });

    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("2D canvas context unavailable inside worker");
    }

    context.drawImage(image, 0, 0);

    const result: PoseLandmarkerResult = landmarker.detect(canvas);
    const landmarks = result.landmarks[0]?.length ?? 0;
    image.close();
    landmarker.close();

    if (landmarks === 0) {
      return {
        requestId,
        status: "error",
        message:
          "MediaPipe loaded but returned no landmarks on the test frame. This is still useful: worker boot and model load are working.",
      };
    }

    return {
      requestId,
      status: "success",
      message: "Worker loaded WASM, initialized Pose Landmarker, and returned landmarks.",
      landmarks,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      requestId,
      status: "error",
      message,
    };
  }
}

async function initLandmarker(
  wasmPath: string,
  modelAssetPath: string,
  options?: {
    minPoseDetectionConfidence?: number;
    minPosePresenceConfidence?: number;
    minTrackingConfidence?: number;
  },
  requestId?: string,
): Promise<WorkerResponse> {
  try {
    await getLandmarker(wasmPath, modelAssetPath, options);
    return {
      requestId,
      status: "ready",
      message: "Pose Landmarker initialized in worker.",
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return { requestId, status: "error", message };
  }
}

async function detectFrame(image: ImageBitmap, timestampMs: number, requestId?: string): Promise<WorkerResponse> {
  try {
    if (!landmarkerPromise) {
      image.close();
      return {
        requestId,
        status: "error",
        message: "Pose worker not initialized before frame detection.",
      };
    }

    const landmarker = await landmarkerPromise;
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");

    if (!context) {
      image.close();
      return {
        requestId,
        status: "error",
        message: "2D canvas context unavailable inside worker",
      };
    }

    context.drawImage(image, 0, 0);
    const result = landmarker.detectForVideo(canvas, timestampMs);
    const landmarks = normalizeLandmarks(result);
    const visibleLandmarks = landmarks.filter((landmark) => landmark.visibility >= 0.35).length;
    const imageWidth = image.width;
    const imageHeight = image.height;
    image.close();

    return {
      requestId,
      status: "frame",
      message: "Frame processed.",
      landmarks,
      visibleLandmarks,
      imageWidth,
      imageHeight,
      detectedAt: Date.now(),
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      requestId,
      status: "error",
      message,
    };
  }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  switch (event.data.type) {
    case "RUN_SPIKE": {
      const response = await runSpike(
        event.data.payload.wasmPath,
        event.data.payload.image,
        event.data.requestId,
      );
      self.postMessage(response);
      break;
    }
    case "INIT": {
        const response = await initLandmarker(
          event.data.payload.wasmPath,
          event.data.payload.modelAssetPath,
          {
            minPoseDetectionConfidence: event.data.payload.minPoseDetectionConfidence,
            minPosePresenceConfidence: event.data.payload.minPosePresenceConfidence,
            minTrackingConfidence: event.data.payload.minTrackingConfidence,
          },
          event.data.requestId,
        );
        self.postMessage(response);
        break;
      }
    case "DETECT_FRAME": {
        const response = await detectFrame(
          event.data.payload.image,
          event.data.payload.timestampMs,
          event.data.requestId,
        );
        self.postMessage(response);
        break;
      }
    default:
      break;
  }
};

export {};
