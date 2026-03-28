import { useEffect, useMemo, useRef, useState } from "react";
import { SurfaceCard } from "@/components/ui/surface-card";
import { getLiveAngles } from "@/lib/angles";
import { detectCameraAngle } from "@/lib/camera-angle";
import { drawPoseOverlay } from "@/lib/pose-draw";
import { evaluateFrameQuality, type PoseLandmarkPoint } from "@/lib/pose";
import PoseWorker from "@/workers/pose-worker?worker";

type WorkerReadyResponse = { status: "ready"; message: string };
type WorkerErrorResponse = { status: "error"; message: string };
type WorkerFrameResponse = {
  status: "frame";
  message: string;
  landmarks: PoseLandmarkPoint[];
  visibleLandmarks: number;
  imageWidth: number;
  imageHeight: number;
  detectedAt: number;
};

type WorkerResponse = WorkerReadyResponse | WorkerErrorResponse | WorkerFrameResponse;

type BufferedPoseFrame = {
  detectedAt: number;
  visibleLandmarks: number;
  landmarks: PoseLandmarkPoint[];
};

const SAMPLE_INTERVAL_MS = 200;
const MAX_BUFFERED_FRAMES = 30;

export function AnalyzePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const clipUrlRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const processingRef = useRef(false);

  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [pipelineState, setPipelineState] = useState<"booting" | "ready" | "error">("booting");
  const [statusMessage, setStatusMessage] = useState(
    "Booting the worker-driven pose pipeline so live camera diagnostics stay off the main thread.",
  );
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [lastLandmarks, setLastLandmarks] = useState<PoseLandmarkPoint[]>([]);
  const [visibleLandmarks, setVisibleLandmarks] = useState(0);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [bufferedFrames, setBufferedFrames] = useState<BufferedPoseFrame[]>([]);
  const [sourceType, setSourceType] = useState<"camera" | "clip" | null>(null);
  const [clipName, setClipName] = useState<string | null>(null);

  useEffect(() => {
    const worker = new PoseWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (response.status === "ready") {
        setPipelineState("ready");
        setPipelineError(null);
        setStatusMessage("Worker ready. Start the live test to stream pose diagnostics.");
        return;
      }

      if (response.status === "error") {
        processingRef.current = false;
        setPipelineState("error");
        setPipelineError(response.message);
        setStatusMessage(response.message);
        return;
      }

      processingRef.current = false;
      setLastLandmarks(response.landmarks);
      setVisibleLandmarks(response.visibleLandmarks);
      setFramesProcessed((count) => count + 1);
      setBufferedFrames((current) => {
        const nextFrames = [
          ...current,
          {
            detectedAt: response.detectedAt,
            visibleLandmarks: response.visibleLandmarks,
            landmarks: response.landmarks,
          },
        ];

        return nextFrames.slice(-MAX_BUFFERED_FRAMES);
      });
    };

    worker.onerror = (event) => {
      processingRef.current = false;
      const message = event.message || "Pose worker failed while running the live pipeline.";
      setPipelineState("error");
      setPipelineError(message);
      setStatusMessage(message);
    };

    worker.postMessage({
      type: "INIT",
      payload: {
        wasmPath: "/mediapipe/wasm",
        modelAssetPath: "/mediapipe/pose_landmarker_lite.task",
      },
    });

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (clipUrlRef.current) {
        URL.revokeObjectURL(clipUrlRef.current);
        clipUrlRef.current = null;
      }
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const liveAngles = useMemo(() => getLiveAngles(lastLandmarks), [lastLandmarks]);
  const cameraAngle = useMemo(() => detectCameraAngle(lastLandmarks), [lastLandmarks]);
  const frameQuality = useMemo(() => evaluateFrameQuality(lastLandmarks), [lastLandmarks]);

  useEffect(() => {
    if (pipelineState !== "ready") {
      return;
    }

    if (lastLandmarks.length === 0) {
      setStatusMessage(
        cameraState === "live"
          ? "Camera live. Step into frame so the worker can lock onto a pose."
          : "Worker ready. Start the live test to stream pose diagnostics.",
      );
      return;
    }

    const readinessPrefix =
      frameQuality.readiness === "ready"
        ? "Pose ready."
        : frameQuality.readiness === "adjusting"
          ? "Framing needs a quick adjustment."
          : "Pose lock is weak.";

    const angleSuffix =
      cameraAngle.label === "unknown"
        ? "Camera angle still estimating."
        : `Camera reads as ${cameraAngle.label}.`;

    setStatusMessage(`${readinessPrefix} ${frameQuality.guidance} ${angleSuffix}`);
  }, [cameraAngle.label, cameraState, frameQuality.guidance, frameQuality.readiness, lastLandmarks.length, pipelineState]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;

    if (!canvas) {
      return;
    }

    drawPoseOverlay(canvas, lastLandmarks);
  }, [lastLandmarks]);

  function resetPoseState() {
    processingRef.current = false;
    setLastLandmarks([]);
    setVisibleLandmarks(0);
    setFramesProcessed(0);
    setBufferedFrames([]);
  }

  function stopSampling() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    processingRef.current = false;
  }

  function clearClipUrl() {
    if (clipUrlRef.current) {
      URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = null;
    }
  }

  function clearVideoSource() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    video.pause();
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  }

  function startSampling(message: string) {
    if (timerRef.current !== null) {
      return;
    }

    timerRef.current = window.setInterval(() => {
      void captureFrame();
    }, SAMPLE_INTERVAL_MS);
    setStatusMessage(message);
  }

  function stopActiveInput(nextMessage?: string) {
    stopSampling();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearVideoSource();
    clearClipUrl();
    resetPoseState();
    setSourceType(null);
    setClipName(null);
    setCameraState("idle");

    const canvas = overlayCanvasRef.current;
    if (canvas) {
      const context = canvas.getContext("2d");
      context?.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (nextMessage) {
      setStatusMessage(nextMessage);
    }
  }

  async function startCamera() {
    try {
      stopActiveInput();
      setCameraState("starting");
      setSourceType("camera");
      setPipelineError(null);
      setStatusMessage("Requesting camera permission...");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 960 },
          height: { ideal: 540 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (!videoRef.current) {
        throw new Error("Video element unavailable");
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      setCameraState("live");

      if (pipelineState === "ready" && timerRef.current === null) {
        startSampling("Camera live. Sampling frames through the worker at 5 FPS.");
      } else if (pipelineState !== "error") {
        setStatusMessage("Camera live. Waiting for MediaPipe initialization to finish.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to access camera";
      setCameraState("error");
      setStatusMessage(message);
    }
  }

  async function handleTrainingClip(file: File | null) {
    if (!file) {
      return;
    }

    try {
      stopActiveInput();
      setCameraState("starting");
      setSourceType("clip");
      setClipName(file.name);
      setPipelineError(null);
      setStatusMessage("Loading training clip...");

      const nextClipUrl = URL.createObjectURL(file);
      clipUrlRef.current = nextClipUrl;

      if (!videoRef.current) {
        throw new Error("Video element unavailable");
      }

      videoRef.current.src = nextClipUrl;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      await videoRef.current.play();

      setCameraState("live");

      if (pipelineState === "ready") {
        startSampling("Training clip loaded. Sampling frames through the worker at 5 FPS.");
      } else {
        setStatusMessage("Training clip loaded. Waiting for MediaPipe initialization to finish.");
      }
    } catch (error) {
      clearClipUrl();
      const message = error instanceof Error ? error.message : "Failed to load training clip";
      setCameraState("error");
      setStatusMessage(message);
    }
  }

  function stopCamera() {
    stopActiveInput("Input stopped. Restart the camera or load another training clip when you want to test again.");
  }

  async function captureFrame() {
    const video = videoRef.current;
    const worker = workerRef.current;

    if (processingRef.current || !video || !worker || pipelineState !== "ready") {
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      return;
    }

    processingRef.current = true;

    try {
      const image = await createImageBitmap(video);
      worker.postMessage(
        {
          type: "DETECT_FRAME",
          payload: {
            image,
          },
        },
        [image],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process video frame";
      processingRef.current = false;
      setPipelineState("error");
      setPipelineError(message);
      setStatusMessage(message);
      console.error("[pose-worker]", error);
    }
  }

  useEffect(() => {
    if (pipelineState === "ready" && cameraState === "live" && timerRef.current === null) {
      startSampling(
        sourceType === "clip"
          ? "MediaPipe ready. Sampling training clip frames through the worker at 5 FPS."
          : "MediaPipe ready. Sampling live camera frames through the worker at 5 FPS.",
      );
    }
  }, [cameraState, pipelineState, sourceType]);

  const readinessTone =
    frameQuality.readiness === "ready"
      ? "bg-[#eaf7ef] text-[#1f6b3d]"
      : frameQuality.readiness === "adjusting"
        ? "bg-[#fff5e5] text-[#9a5a00]"
        : "bg-[#fff1f1] text-[#8c1d18]";

  return (
    <div className="space-y-6">
      <SurfaceCard
        eyebrow="Block 3"
        title="Worker-driven pose pipeline"
        description="This path keeps live frame analysis off the main thread, draws a skeleton overlay, and surfaces the camera-angle plus angle diagnostics we need before recording or Gemini analysis."
      >
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => {
              void startCamera();
            }}
            disabled={cameraState === "starting" || cameraState === "live"}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start live test
          </button>
          <label className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)]">
            Add training clip
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                void handleTrainingClip(nextFile);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={stopCamera}
            disabled={cameraState !== "live" && cameraState !== "starting"}
            className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop
          </button>
          <p className="text-sm text-[var(--ink-soft)]">
            Best test: full body in frame, 6-8 feet back, neutral background, decent light, ideally a clean side view. Training clips work too.
          </p>
        </div>
      </SurfaceCard>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <SurfaceCard
          eyebrow="Camera"
          title="Live preview"
          description="Video and canvas stay mirrored together so the overlay tracks what the athlete sees in the preview."
        >
          <div className="relative overflow-hidden rounded-[28px] bg-[#0f172a]">
            <div className="relative aspect-video w-full" style={{ transform: "scaleX(-1)" }}>
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                playsInline
                controls={sourceType === "clip"}
                onPlay={() => {
                  if (sourceType === "clip" && pipelineState === "ready" && cameraState === "live") {
                    startSampling("Training clip playing. Sampling frames through the worker at 5 FPS.");
                  }
                }}
                onPause={() => {
                  if (sourceType === "clip") {
                    stopSampling();
                    setStatusMessage("Training clip paused. Resume playback to continue pose sampling.");
                  }
                }}
                onEnded={() => {
                  if (sourceType === "clip") {
                    stopSampling();
                    setStatusMessage("Training clip finished. Scrub, replay, or load another clip to keep testing.");
                  }
                }}
              />
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </div>
            <div className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white">
              {cameraState}
            </div>
            <div className="absolute bottom-4 left-4 rounded-[20px] bg-black/55 px-4 py-3 text-sm text-white backdrop-blur">
              {visibleLandmarks > 0 ? `${visibleLandmarks} landmarks visible` : "No pose landmarks yet"}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Status"
          title="Pose diagnostics"
          description={statusMessage}
        >
          <div className="space-y-4">
            {pipelineError ? (
              <div className="rounded-[24px] border border-[#f0b8b8] bg-[#fff1f1] px-4 py-3 text-sm text-[#8c1d18]">
                {pipelineError}
              </div>
            ) : null}
            <div className={`rounded-[24px] px-4 py-3 text-sm font-medium ${readinessTone}`}>
              {frameQuality.guidance}
            </div>
            {[
              ["Pipeline", pipelineState],
              ["Source", sourceType ?? "none"],
              ["Camera", cameraState],
              ["Frames processed", String(framesProcessed)],
              ["Visible landmarks", String(visibleLandmarks)],
              ["Camera angle", cameraAngle.label],
              ["Buffered frames", String(bufferedFrames.length)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-[24px] bg-[var(--surface-2)] px-4 py-3 text-sm"
              >
                <span className="font-medium text-[var(--ink)]">{label}</span>
                <span className="text-[var(--ink-soft)]">{value}</span>
              </div>
            ))}
            <div className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-soft)]">
              <p className="font-medium text-[var(--ink)]">Camera guidance</p>
              <p className="mt-2">{cameraAngle.guidance}</p>
              <p className="mt-2">
                width ratio: {cameraAngle.widthRatio ?? "-"} | depth ratio: {cameraAngle.depthRatio ?? "-"}
              </p>
              {clipName ? <p className="mt-2">clip: {clipName}</p> : null}
            </div>
            {frameQuality.issues.length > 0 ? (
              <div className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-soft)]">
                <p className="font-medium text-[var(--ink)]">Quick fixes</p>
                <ul className="mt-2 space-y-2">
                  {frameQuality.issues.map((issue) => (
                    <li key={issue}>- {issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </SurfaceCard>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SurfaceCard
          eyebrow="Angles"
          title="Live joint reads"
          description="These values update from the worker response and give us the minimum viable debug layer before rep segmentation."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {liveAngles.metrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4"
              >
                <p className="text-sm font-medium text-[var(--ink)]">{metric.label}</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--accent-strong)]">
                  {metric.value === null ? "--" : `${metric.value}${metric.unit}`}
                </p>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Pipeline"
          title="Phase readiness"
          description="This is the bridge from camera validation into the later rep-detection and analysis blocks."
        >
          <div className="grid gap-3">
            {[
              ["Full body visible", frameQuality.fullBodyVisible ? "yes" : "no"],
              ["Centered", frameQuality.centered ? "yes" : "no"],
              ["Clipped", frameQuality.clipped ? "yes" : "no"],
              ["Dominant side", liveAngles.dominantSide ?? "unknown"],
              ["Camera confidence", `${Math.round(cameraAngle.confidence * 100)}%`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-[24px] bg-[var(--surface-2)] px-4 py-3 text-sm"
              >
                <span className="font-medium text-[var(--ink)]">{label}</span>
                <span className="text-[var(--ink-soft)]">{value}</span>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
