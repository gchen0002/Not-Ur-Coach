import { useEffect, useRef, useState } from "react";
import { SurfaceCard } from "@/components/ui/surface-card";
import PoseWorker from "@/workers/pose-worker?worker";

type WorkerResponse =
  | { status: "ready"; message: string }
  | { status: "frame"; message: string; landmarks: number }
  | { status: "success"; message: string; landmarks: number }
  | { status: "error"; message: string };

export function AnalyzePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const processingRef = useRef(false);

  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [workerState, setWorkerState] = useState<"booting" | "ready" | "error">("booting");
  const [statusMessage, setStatusMessage] = useState(
    "Start camera access to validate Chrome webcam capture and worker-based pose detection.",
  );
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [lastLandmarks, setLastLandmarks] = useState(0);
  const [framesProcessed, setFramesProcessed] = useState(0);

  useEffect(() => {
    const worker = new PoseWorker();

    workerRef.current = worker;
    worker.postMessage({
      type: "INIT",
      payload: {
        wasmPath: "/mediapipe/wasm",
        modelAssetPath: "/mediapipe/pose_landmarker_lite.task",
      },
    });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.status === "ready") {
        setWorkerState("ready");
        setWorkerError(null);
        setStatusMessage(data.message);
        if (streamRef.current && timerRef.current === null) {
          timerRef.current = window.setInterval(() => {
            void captureFrame();
          }, 500);
          setStatusMessage("Pose worker ready. Sampling live camera frames at 2 FPS.");
        }
        return;
      }

      if (data.status === "frame" || data.status === "success") {
        setLastLandmarks(data.landmarks);
        setFramesProcessed((count) => count + 1);
        setStatusMessage(
          data.landmarks > 0
            ? `Pose detected. Streaming at low FPS for stability checks.`
            : "No pose detected in the current frame. Adjust framing and step back.",
        );
        processingRef.current = false;
        return;
      }

      if (data.status === "error") {
        setWorkerState("error");
        setWorkerError(data.message);
        setStatusMessage(data.message);
        console.error("[pose-worker]", data.message);
        processingRef.current = false;
      }
    };

    worker.onerror = (event) => {
      setWorkerState("error");
      const message = event.message || "Pose worker crashed. Check browser console for the underlying error.";
      setWorkerError(message);
      setStatusMessage(message);
      console.error("[pose-worker]", event);
      processingRef.current = false;
    };

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      worker.terminate();
    };
  }, []);

  async function startCamera() {
    try {
      setCameraState("starting");
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
      if (workerState !== "error") {
        setStatusMessage(
          workerState === "ready"
            ? "Camera live. Sampling frames at 2 FPS."
            : "Camera live. Waiting for MediaPipe worker to finish initializing.",
        );
      }

      if (workerState === "ready" && timerRef.current === null) {
        timerRef.current = window.setInterval(() => {
          void captureFrame();
        }, 500);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to access camera";
      setCameraState("error");
      setStatusMessage(message);
    }
  }

  function stopCamera() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    processingRef.current = false;
    setCameraState("idle");
    setStatusMessage("Camera stopped. Restart when you want to test framing again.");
  }

  async function captureFrame() {
    if (processingRef.current || !videoRef.current || !workerRef.current) {
      return;
    }

    const video = videoRef.current;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      return;
    }

    processingRef.current = true;

    try {
      const bitmap = await createImageBitmap(video);
      workerRef.current.postMessage(
        {
          type: "DETECT_FRAME",
          payload: {
            image: bitmap,
          },
        },
        [bitmap],
      );
    } catch (error) {
      processingRef.current = false;
      const message = error instanceof Error ? error.message : "Failed to capture frame from video";
      setStatusMessage(message);
    }
  }

  return (
    <div className="space-y-6">
      <SurfaceCard
        eyebrow="Block 3"
        title="Chrome live camera test"
        description="This is the first real-time validation path: webcam access, frame capture, worker messaging, and MediaPipe pose detection on live video."
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
          <button
            type="button"
            onClick={stopCamera}
            disabled={cameraState !== "live"}
            className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop
          </button>
          <p className="text-sm text-[var(--ink-soft)]">
            Best test: full body in frame, 6-8 feet back, neutral background, decent light.
          </p>
        </div>
      </SurfaceCard>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <SurfaceCard
          eyebrow="Camera"
          title="Live preview"
          description="This feed is sampled at low FPS to validate the end-to-end browser path before we add rep detection or overlays."
        >
          <div className="relative overflow-hidden rounded-[28px] bg-[#0f172a]">
            <video
              ref={videoRef}
              className="aspect-video w-full object-cover"
              autoPlay
              muted
              playsInline
            />
            <div className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white">
              {cameraState}
            </div>
            <div className="absolute bottom-4 left-4 rounded-[20px] bg-black/55 px-4 py-3 text-sm text-white backdrop-blur">
              {lastLandmarks > 0 ? `${lastLandmarks} landmarks detected` : "No pose landmarks yet"}
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Status"
          title="Worker diagnostics"
          description={statusMessage}
        >
          <div className="space-y-3">
            {workerError ? (
              <div className="rounded-[24px] border border-[#f0b8b8] bg-[#fff1f1] px-4 py-3 text-sm text-[#8c1d18]">
                {workerError}
              </div>
            ) : null}
            {[
              ["Worker", workerState],
              ["Camera", cameraState],
              ["Frames processed", String(framesProcessed)],
              ["Last landmark count", String(lastLandmarks)],
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
