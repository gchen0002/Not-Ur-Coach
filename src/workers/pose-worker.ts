/// <reference lib="webworker" />
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

type SpikeMessage = {
  type: "RUN_SPIKE";
  payload: {
    wasmPath: string;
    image: ImageBitmap;
  };
};

type InitMessage = {
  type: "INIT";
  payload: {
    wasmPath: string;
    modelAssetPath: string;
  };
};

type DetectFrameMessage = {
  type: "DETECT_FRAME";
  payload: {
    image: ImageBitmap;
  };
};

type WorkerMessage = SpikeMessage | InitMessage | DetectFrameMessage;

type SpikeResponse =
  | { status: "success"; message: string; landmarks: number }
  | { status: "error"; message: string };

type WorkerResponse =
  | SpikeResponse
  | { status: "ready"; message: string }
  | { status: "frame"; message: string; landmarks: number }
  | { status: "error"; message: string };

let landmarkerPromise: Promise<PoseLandmarker> | null = null;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.stack ? `${error.message}\n${error.stack}` : error.message;
  }

  return "Unknown MediaPipe worker error";
}

async function getLandmarker(
  wasmPath: string,
  modelAssetPath: string,
): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(wasmPath);
      return PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath,
        },
        runningMode: "IMAGE",
        numPoses: 1,
      });
    })();
  }

  return landmarkerPromise;
}

async function runSpike(wasmPath: string, image: ImageBitmap): Promise<SpikeResponse> {
  try {
    const landmarker = await getLandmarker(
      wasmPath,
      "/mediapipe/pose_landmarker_lite.task",
    );

    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("2D canvas context unavailable inside worker");
    }

    context.drawImage(image, 0, 0);

    const result: PoseLandmarkerResult = landmarker.detect(canvas);
    const landmarks = result.landmarks[0]?.length ?? 0;
    image.close();

    if (landmarks === 0) {
      return {
        status: "error",
        message:
          "MediaPipe loaded but returned no landmarks on the test frame. This is still useful: worker boot and model load are working.",
      };
    }

    return {
      status: "success",
      message: "Worker loaded WASM, initialized Pose Landmarker, and returned landmarks.",
      landmarks,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      status: "error",
      message,
    };
  }
}

async function initLandmarker(
  wasmPath: string,
  modelAssetPath: string,
): Promise<WorkerResponse> {
  try {
    await getLandmarker(wasmPath, modelAssetPath);
    return {
      status: "ready",
      message: "Pose Landmarker initialized in worker.",
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return { status: "error", message };
  }
}

async function detectFrame(image: ImageBitmap): Promise<WorkerResponse> {
  try {
    if (!landmarkerPromise) {
      image.close();
      return {
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
        status: "error",
        message: "2D canvas context unavailable inside worker",
      };
    }

    context.drawImage(image, 0, 0);
    const result = landmarker.detect(canvas);
    image.close();

    return {
      status: "frame",
      message: "Frame processed.",
      landmarks: result.landmarks[0]?.length ?? 0,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
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
      );
      self.postMessage(response);
      break;
    }
    case "INIT": {
      const response = await initLandmarker(
        event.data.payload.wasmPath,
        event.data.payload.modelAssetPath,
      );
      self.postMessage(response);
      break;
    }
    case "DETECT_FRAME": {
      const response = await detectFrame(event.data.payload.image);
      self.postMessage(response);
      break;
    }
    default:
      break;
  }
};

export {};
