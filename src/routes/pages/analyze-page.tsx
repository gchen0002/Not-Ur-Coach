import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { SurfaceCard } from "@/components/ui/surface-card";
import { buildAnalyzePayload, type BufferedPoseFrame } from "@/lib/analysis-payload";
import { createAnalysisDraft } from "@/lib/analysis-draft";
import { getLiveAngles } from "@/lib/angles";
import { detectCameraAngle } from "@/lib/camera-angle";
import { drawPoseOverlay } from "@/lib/pose-draw";
import { evaluateFrameQuality, summarizePoseWindow, type PoseLandmarkPoint } from "@/lib/pose";

const SAMPLE_INTERVAL_MS = 200;
const MAX_BUFFERED_FRAMES = 30;

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return null;
  }

  const candidates = [
    "video/mp4;codecs=h264",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function getRecordingExtension(mimeType: string) {
  if (mimeType.includes("mp4")) {
    return "mp4";
  }

  if (mimeType.includes("ogg")) {
    return "ogv";
  }

  return "webm";
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

function summarizeError(message: string) {
  return message.split("\n")[0] || "Pose pipeline failed to initialize.";
}

function getClipDecodeErrorMessage(fileName?: string | null) {
  const looksLikeMov = fileName?.toLowerCase().endsWith(".mov");

  if (looksLikeMov) {
    return "This .MOV clip should work on supported mobile browsers, but your current browser may not decode this recording format. If playback stays blank here, test on the phone directly or export an H.264 MP4 fallback.";
  }

  return "This training clip could not be decoded in the browser. Try an MP4 encoded as H.264 for the most reliable testing path.";
}

function waitForVideoReadiness(video: HTMLVideoElement, fileName?: string | null) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const handleLoadedData = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error(getClipDecodeErrorMessage(fileName)));
    };

    const cleanup = () => {
      video.removeEventListener("loadeddata", handleLoadedData);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("loadeddata", handleLoadedData, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

export function AnalyzePage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const shouldLoadRecordingRef = useRef(false);
  const clipUrlRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const processingRef = useRef(false);

  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [pipelineState, setPipelineState] = useState<"booting" | "ready" | "error">("booting");
  const [statusMessage, setStatusMessage] = useState(
    "Initializing MediaPipe so you can test clips and live camera input on this page.",
  );
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [lastLandmarks, setLastLandmarks] = useState<PoseLandmarkPoint[]>([]);
  const [visibleLandmarks, setVisibleLandmarks] = useState(0);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [bufferedFrames, setBufferedFrames] = useState<BufferedPoseFrame[]>([]);
  const [sourceType, setSourceType] = useState<"camera" | "clip" | null>(null);
  const [clipName, setClipName] = useState<string | null>(null);
  const [clipState, setClipState] = useState<"idle" | "loading" | "playing" | "paused" | "ended" | "error">("idle");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "processing" | "error">("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordedClipName, setRecordedClipName] = useState<string | null>(null);

  const recordingSupported = typeof MediaRecorder !== "undefined";

  useEffect(() => {
    let cancelled = false;

    async function initLandmarker() {
      try {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/pose_landmarker_lite.task",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });

        if (cancelled) {
          landmarker.close();
          return;
        }

        landmarkerRef.current = landmarker;
        setPipelineState("ready");
        setPipelineError(null);
        setStatusMessage("Pose pipeline ready. Start the camera or load a training clip.");
      } catch (error) {
        const message = summarizeError(
          error instanceof Error ? error.message : "Failed to initialize MediaPipe Pose Landmarker.",
        );
        setPipelineState("error");
        setPipelineError(message);
        setStatusMessage(message);
      }
    }

    void initLandmarker();

    return () => {
      cancelled = true;

      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (clipUrlRef.current) {
        URL.revokeObjectURL(clipUrlRef.current);
        clipUrlRef.current = null;
      }
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  const liveAngles = useMemo(() => getLiveAngles(lastLandmarks), [lastLandmarks]);
  const cameraAngle = useMemo(() => detectCameraAngle(lastLandmarks), [lastLandmarks]);
  const frameQuality = useMemo(() => evaluateFrameQuality(lastLandmarks), [lastLandmarks]);
  const windowQuality = useMemo(
    () => summarizePoseWindow(bufferedFrames.map((frame) => evaluateFrameQuality(frame.landmarks))),
    [bufferedFrames],
  );
  const analyzePayload = useMemo(
    () =>
      buildAnalyzePayload({
        sourceType,
        clipName,
        bufferedFrames,
        frameQuality,
        windowQuality,
        cameraAngle,
        liveAngles,
      }),
    [bufferedFrames, cameraAngle, clipName, frameQuality, liveAngles, sourceType, windowQuality],
  );
  const analysisDraft = useMemo(() => createAnalysisDraft(analyzePayload), [analyzePayload]);

  useEffect(() => {
    const canvas = overlayCanvasRef.current;

    if (!canvas) {
      return;
    }

    drawPoseOverlay(canvas, lastLandmarks);
  }, [lastLandmarks]);

  useEffect(() => {
    if (pipelineState === "error") {
      setStatusMessage(pipelineError ?? "Pose pipeline failed to initialize in this browser session.");
      return;
    }

    if (pipelineState !== "ready") {
      return;
    }

    if (lastLandmarks.length === 0) {
      setStatusMessage(
        sourceType === "clip"
          ? "Training clip loaded. Press play if needed so the pose pipeline can sample frames."
          : cameraState === "live"
            ? "Camera live. Step into frame so the pose pipeline can lock onto a pose."
            : "Pose pipeline ready. Start the camera or load a training clip.",
      );
      return;
    }

    const readinessPrefix =
      frameQuality.readiness === "ready"
        ? "Pose ready."
        : frameQuality.readiness === "adjusting"
          ? "Framing needs a quick adjustment."
          : "Pose lock is weak.";

    const analysisPrefix =
      frameQuality.analysisReadiness === "full"
        ? "Standard analysis is allowed."
        : frameQuality.analysisReadiness === "best_effort"
          ? "Best-effort analysis is allowed."
          : "This clip should be rejected.";

    const angleSuffix =
      cameraAngle.label === "unknown"
        ? "Camera angle still estimating."
        : `Camera reads as ${cameraAngle.label}.`;

    setStatusMessage(`${readinessPrefix} ${analysisPrefix} ${frameQuality.guidance} ${angleSuffix}`);
  }, [cameraAngle.label, cameraState, frameQuality.analysisReadiness, frameQuality.guidance, frameQuality.readiness, lastLandmarks.length, pipelineError, pipelineState, sourceType]);

  function resetPoseState() {
    processingRef.current = false;
    setLastLandmarks([]);
    setVisibleLandmarks(0);
    setFramesProcessed(0);
    setBufferedFrames([]);
  }

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function resetRecordingState() {
    clearRecordingTimer();
    shouldLoadRecordingRef.current = false;
    recordingChunksRef.current = [];
    mediaRecorderRef.current = null;
    setRecordingState("idle");
    setRecordingDuration(0);
    setRecordingError(null);
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
    shouldLoadRecordingRef.current = false;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    clearRecordingTimer();
    stopSampling();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    clearVideoSource();
    clearClipUrl();
    resetPoseState();
    setSourceType(null);
    setClipName(null);
    setCameraState("idle");
    setClipState("idle");
    resetRecordingState();

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
      setClipState("idle");
      setPipelineError(null);
      setRecordingError(null);
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

      if (pipelineState === "ready") {
        startSampling("Camera live. Sampling frames at 5 FPS.");
      } else if (pipelineState !== "error") {
        setStatusMessage("Camera live. Waiting for MediaPipe initialization to finish.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to access camera";
      setCameraState("error");
      setPipelineError(message);
      setStatusMessage(message);
    }
  }

  async function handleTrainingClip(file: File | null) {
    if (!file) {
      return;
    }

    try {
      stopActiveInput();
      setCameraState("idle");
      setSourceType("clip");
      setClipName(file.name);
      setClipState("loading");
      setRecordingState("idle");
      setPipelineError(null);
      setStatusMessage("Loading training clip...");

      const nextClipUrl = URL.createObjectURL(file);
      clipUrlRef.current = nextClipUrl;

      if (!videoRef.current) {
        throw new Error("Video element unavailable");
      }

      videoRef.current.src = nextClipUrl;
      videoRef.current.preload = "auto";
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      await waitForVideoReadiness(videoRef.current, file.name);
      await videoRef.current.play();

      setClipState("playing");

      if (pipelineState === "ready") {
        startSampling("Training clip loaded. Sampling frames at 5 FPS.");
      } else if (pipelineState !== "error") {
        setStatusMessage("Training clip loaded. Waiting for MediaPipe initialization to finish.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load training clip";
      setClipState("error");
      setPipelineError(message);
      setStatusMessage(message);
    }
  }

  async function startRecording() {
    if (!recordingSupported) {
      const message = "This browser does not support in-app recording yet.";
      setRecordingError(message);
      setStatusMessage(message);
      return;
    }

    if (!streamRef.current || sourceType !== "camera" || cameraState !== "live") {
      const message = "Start the live camera first, then record a clip from the same session.";
      setRecordingError(message);
      setStatusMessage(message);
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      return;
    }

    try {
      const mimeType = getSupportedRecordingMimeType();
      const mediaRecorder = mimeType
        ? new MediaRecorder(streamRef.current, { mimeType })
        : new MediaRecorder(streamRef.current);

      mediaRecorderRef.current = mediaRecorder;
      recordingChunksRef.current = [];
      shouldLoadRecordingRef.current = false;
      setRecordingError(null);
      setRecordedClipName(null);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onerror = () => {
        const message = "Recording failed before the clip could be saved.";
        clearRecordingTimer();
        setRecordingState("error");
        setRecordingError(message);
        setStatusMessage(message);
      };

      mediaRecorder.onstop = async () => {
        const nextChunks = [...recordingChunksRef.current];
        const nextMimeType = mediaRecorder.mimeType || mimeType || "video/webm";
        const shouldLoadRecording = shouldLoadRecordingRef.current;

        clearRecordingTimer();
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        shouldLoadRecordingRef.current = false;

        if (nextChunks.length === 0) {
          const message = "Recording stopped, but no clip data was captured.";
          setRecordingState("error");
          setRecordingError(message);
          setStatusMessage(message);
          return;
        }

        const extension = getRecordingExtension(nextMimeType);
        const fileName = `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
        const file = new File(nextChunks, fileName, { type: nextMimeType });

        setRecordedClipName(fileName);

        if (!shouldLoadRecording) {
          setRecordingState("idle");
          return;
        }

        setRecordingState("processing");
        setStatusMessage("Recording saved. Loading the captured clip into analysis preview...");
        await handleTrainingClip(file);
        setRecordingState("idle");
      };

      mediaRecorder.start(1000);
      setRecordingState("recording");
      setRecordingDuration(0);
      setStatusMessage("Recording in progress. Stop when you want to analyze the captured clip.");
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingDuration((seconds) => seconds + 1);
      }, 1000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start recording";
      setRecordingState("error");
      setRecordingError(message);
      setStatusMessage(message);
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
      return;
    }

    shouldLoadRecordingRef.current = true;
    setRecordingState("processing");
    setStatusMessage("Finishing recording and preparing the captured clip...");
    mediaRecorderRef.current.stop();
  }

  function stopCamera() {
    stopActiveInput("Input stopped. Restart the camera or load another training clip when you want to test again.");
  }

  async function captureFrame() {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (processingRef.current || !video || !landmarker || pipelineState !== "ready") {
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      return;
    }

    processingRef.current = true;

    try {
      const result = landmarker.detectForVideo(video, performance.now());
      const landmarks = normalizeLandmarks(result);
      const nextVisibleLandmarks = landmarks.filter((landmark) => landmark.visibility >= 0.45).length;

      setLastLandmarks(landmarks);
      setVisibleLandmarks(nextVisibleLandmarks);
      setFramesProcessed((count) => count + 1);
      setBufferedFrames((current) => {
        const nextFrames = [
          ...current,
          {
            detectedAt: Date.now(),
            visibleLandmarks: nextVisibleLandmarks,
            landmarks,
          },
        ];

        return nextFrames.slice(-MAX_BUFFERED_FRAMES);
      });
    } catch (error) {
      const baseMessage = error instanceof Error ? error.message : "Failed to process video frame";
      const message = summarizeError(
        sourceType === "clip" ? getClipDecodeErrorMessage(clipName) : baseMessage,
      );

      setPipelineError(message);
      setStatusMessage(message);
      stopSampling();

      if (sourceType === "clip") {
        setClipState("error");
      } else {
        setCameraState("error");
      }
    } finally {
      processingRef.current = false;
    }
  }

  useEffect(() => {
    const shouldSample =
      pipelineState === "ready" &&
      ((sourceType === "camera" && cameraState === "live") ||
        (sourceType === "clip" && clipState === "playing"));

    if (shouldSample && timerRef.current === null) {
      startSampling(sourceType === "clip" ? "Training clip playing. Sampling frames at 5 FPS." : "Camera live. Sampling frames at 5 FPS.");
    }

    if (!shouldSample && timerRef.current !== null) {
      stopSampling();
    }
  }, [cameraState, clipState, pipelineState, sourceType]);

  const readinessTone =
    frameQuality.readiness === "ready"
      ? "bg-[#eaf7ef] text-[#1f6b3d]"
      : frameQuality.readiness === "adjusting"
        ? "bg-[#fff5e5] text-[#9a5a00]"
        : "bg-[#fff1f1] text-[#8c1d18]";

  const analysisTone =
    frameQuality.analysisReadiness === "full"
      ? "bg-[#eaf7ef] text-[#1f6b3d]"
      : frameQuality.analysisReadiness === "best_effort"
        ? "bg-[#fff5e5] text-[#9a5a00]"
        : "bg-[#fff1f1] text-[#8c1d18]";

  const windowAnalysisTone =
    windowQuality.analysisReadiness === "full"
      ? "bg-[#eaf7ef] text-[#1f6b3d]"
      : windowQuality.analysisReadiness === "best_effort"
        ? "bg-[#fff5e5] text-[#9a5a00]"
        : "bg-[#fff1f1] text-[#8c1d18]";

  return (
    <div className="space-y-6">
      <SurfaceCard
        eyebrow="Block 4"
        title="Capture and analyze testbed"
        description="This page now sits across Blocks 3-4: it can run live pose diagnostics, upload training clips, and record a camera session into a reusable analysis clip before the full Gemini pipeline ships." 
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
            onClick={() => {
              void startRecording();
            }}
            disabled={
              !recordingSupported ||
              sourceType !== "camera" ||
              cameraState !== "live" ||
              recordingState === "recording" ||
              recordingState === "processing"
            }
            className="rounded-full border border-[var(--outline)] bg-[var(--surface-accent)] px-5 py-3 text-sm font-semibold text-[var(--accent-strong)] shadow-[var(--shadow-1)] transition hover:brightness-98 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start recording
          </button>
          <button
            type="button"
            onClick={stopRecording}
            disabled={recordingState !== "recording"}
            className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop recording
          </button>
          <button
            type="button"
            onClick={stopCamera}
            disabled={sourceType === null}
            className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop
          </button>
          <p className="text-sm text-[var(--ink-soft)]">
            Best test: full body in frame, 6-8 feet back, neutral background, decent light, ideally a clean side view. You can record from the live camera, then review the captured clip here.
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
                preload="auto"
                onPlay={() => {
                  if (sourceType === "clip") {
                    setClipState("playing");
                  }
                }}
                onPause={() => {
                  if (sourceType === "clip") {
                    setClipState("paused");
                    setStatusMessage("Training clip paused. Resume playback to continue pose sampling.");
                  }
                }}
                onEnded={() => {
                  if (sourceType === "clip") {
                    setClipState("ended");
                    setStatusMessage("Training clip finished. Scrub, replay, or load another clip to keep testing.");
                  }
                }}
                onError={() => {
                  if (sourceType === "clip") {
                    const message = getClipDecodeErrorMessage(clipName);
                    setClipState("error");
                    setPipelineError(message);
                    setStatusMessage(message);
                  }
                }}
              />
              <canvas
                ref={overlayCanvasRef}
                className="pointer-events-none absolute inset-0 h-full w-full"
              />
            </div>
            <div className="absolute left-4 top-4 rounded-full bg-black/55 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white">
              {recordingState === "recording"
                ? `recording ${recordingDuration}s`
                : sourceType === "clip"
                  ? clipState
                  : cameraState}
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
            <div className={`rounded-[24px] px-4 py-3 text-sm font-medium ${analysisTone}`}>
              {frameQuality.analysisReason}
            </div>
            {[
              ["Pipeline", pipelineState],
              ["Source", sourceType ?? "none"],
              [sourceType === "clip" ? "Clip" : "Camera", sourceType === "clip" ? clipState : cameraState],
              ["Recording", recordingState],
              ["Recording seconds", String(recordingDuration)],
              ["Analysis mode", frameQuality.analysisReadiness],
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
              {recordedClipName ? <p className="mt-2">last recording: {recordedClipName}</p> : null}
            </div>
            {recordingError ? (
              <div className="rounded-[24px] border border-[#f0b8b8] bg-[#fff1f1] px-4 py-3 text-sm text-[#8c1d18]">
                {recordingError}
              </div>
            ) : null}
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
          description="These values update from the current pose frames and give us the debug layer we need before rep segmentation."
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
          eyebrow="Analyze Payload"
          title="Gemini handoff preview"
          description="This is the structured payload we can pass into the future analysis action once Convex `analyze.ts` exists."
        >
          <div className="rounded-[24px] bg-[var(--surface-2)] p-4">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-[var(--ink-soft)]">
              {JSON.stringify(analyzePayload, null, 2)}
            </pre>
          </div>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Analysis Draft"
          title="Backend fallback preview"
          description="This is the first-pass analysis draft the Convex action can already generate before the real Gemini call is wired in."
        >
          <div className="rounded-[24px] bg-[var(--surface-2)] p-4">
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-[var(--ink-soft)]">
              {JSON.stringify(analysisDraft, null, 2)}
            </pre>
          </div>
        </SurfaceCard>

        <SurfaceCard
          eyebrow="Pipeline"
          title="Phase readiness"
          description="This is still a test harness, but it now tells us whether the buffered clip window should get full analysis, best-effort analysis, or a hard reject."
        >
          <div className="grid gap-3">
            <div className={`rounded-[24px] px-4 py-4 text-sm font-medium ${windowAnalysisTone}`}>
              {windowQuality.recommendation}
            </div>
            {[
              ["Window decision", windowQuality.analysisReadiness],
              ["Sampled frames", String(windowQuality.sampledFrames)],
              ["Full frames", String(windowQuality.fullFrames)],
              ["Best-effort frames", String(windowQuality.bestEffortFrames)],
              ["Rejected frames", String(windowQuality.rejectedFrames)],
              ["Analysis mode", frameQuality.analysisReadiness],
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
            {windowQuality.primaryIssues.length > 0 ? (
              <div className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-soft)]">
                <p className="font-medium text-[var(--ink)]">Window-level blockers</p>
                <ul className="mt-2 space-y-2">
                  {windowQuality.primaryIssues.map((issue) => (
                    <li key={issue}>- {issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
