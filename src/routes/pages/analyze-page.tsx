import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@google/genai";
import { useRouter } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import { AnalysisResultsPanel } from "@/components/analyze/analysis-results-panel";
import { ChatPanel } from "@/components/analyze/chat-panel";
import { LiveCoachPanel } from "@/components/analyze/live-coach-panel";
import { LiveSessionPanel } from "@/components/analyze/live-session-panel";
import { ProgressHistoryPanel } from "@/components/analyze/progress-history-panel";
import { TempoTrackPanel } from "@/components/analyze/tempo-track-panel";
import { TtsPanel } from "@/components/analyze/tts-panel";
import { appendAnalysisHistory, loadAnalysisHistory } from "@/lib/analysis-history";
import { buildAnalyzePayload, type BufferedPoseFrame } from "@/lib/analysis-payload";
import { createAnalysisDraft, createLocalAnalysisRun } from "@/lib/analysis-draft";
import type { ClipContextInferenceRequest, ClipContextInferenceResult } from "@/lib/clip-context-contract";
import { SEEDED_EXERCISE_CATALOG } from "@/lib/exercise-catalog";
import type { ExerciseCatalogEntry } from "@/lib/exercise-intake-contract";
import type { AnalysisHistoryEntry, AnalysisRunResult, AnalyzePayload } from "@/lib/analysis-contract";
import type { ChatMessage, ChatReply, ChatRequest } from "@/lib/chat-contract";
import { createLocalChatReply } from "@/lib/chat-draft";
import { createHydratedLivePromptBudget, createLiveDeltaPacket, createLiveSessionDraft } from "@/lib/live-session";
import type {
  LiveAuthTokenRequest,
  LiveAuthTokenResult,
  LiveCoachContextRequest,
  LiveCoachContextResult,
  LiveSessionRecord,
  LiveSessionSaveRequest,
} from "@/lib/live-session-contract";
import type { TempoTrackRequest, TempoTrackResponse } from "@/lib/tempo-track-contract";
import type { TtsRequest, TtsResponse } from "@/lib/tts-contract";
import { createTempoTrackDraft } from "@/lib/tempo-track-draft";
import { createLocalTtsResponse } from "@/lib/tts-draft";
import { resolveExerciseMovementProfile } from "@/lib/exercise-profile";
import { getLiveAngles } from "@/lib/angles";
import { detectCameraAngle } from "@/lib/camera-angle";
import { drawPoseOverlay } from "@/lib/pose-draw";
import { evaluateFrameQuality, summarizePoseWindow, type PoseLandmarkPoint } from "@/lib/pose";

const SAMPLE_INTERVAL_MS = 200;
const MAX_BUFFERED_FRAMES = 30;
const MIN_AUTO_ANALYZE_FRAMES = 12;
const MEDIAPIPE_WASM_BASE = "/mediapipe/wasm";
const POSE_WORKER_DETECTION_CONFIDENCE = 0.45;
const POSE_WORKER_PRESENCE_CONFIDENCE = 0.35;
const POSE_WORKER_TRACKING_CONFIDENCE = 0.35;

type PoseWorkerRequest =
  | {
      type: "INIT";
      requestId: string;
      payload: {
        wasmPath: string;
        modelAssetPath: string;
        minPoseDetectionConfidence: number;
        minPosePresenceConfidence: number;
        minTrackingConfidence: number;
      };
    }
  | {
      type: "DETECT_FRAME";
      requestId: string;
      payload: {
        image: ImageBitmap;
        timestampMs: number;
      };
    };

type PoseWorkerResponse =
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
  | { requestId?: string; status: "error"; message: string };

function createPoseWorker() {
  return new Worker(new URL("../../workers/pose-worker.ts", import.meta.url), {
    type: "module",
    name: "pose-worker-analyze",
  });
}

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

function createSeedChatMessage(result: AnalysisRunResult): ChatMessage {
  return {
    id: `${Date.now()}-seed`,
    role: "assistant",
    content: `I have your latest ${result.mode === "best_effort" ? "best-effort" : result.mode} analysis ready. Ask what to fix first, why the score landed where it did, or which cue to focus on next.`,
    createdAt: Date.now(),
    provider: result.provider,
  };
}

export function AnalyzePage() {
  const router = useRouter();
  const clipAutoAnalyzePendingRef = useRef(false);
  const clipContextRequestIdRef = useRef(0);
  const poseWorkerRef = useRef<Worker | null>(null);
  const poseWorkerRequestIdRef = useRef(0);
  const liveSessionRef = useRef<Session | null>(null);
  const liveAutoSnapshotTimerRef = useRef<number | null>(null);
  const liveSnapshotInFlightRef = useRef(false);
  const liveMicStreamRef = useRef<MediaStream | null>(null);
  const liveMicRecorderRef = useRef<MediaRecorder | null>(null);
  const liveAssistantBufferRef = useRef("");
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const shouldLoadRecordingRef = useRef(false);
  const clipUrlRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const speechUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

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
  const [exerciseCatalog, setExerciseCatalog] = useState<ExerciseCatalogEntry[]>(SEEDED_EXERCISE_CATALOG);
  const [clipExerciseName, setClipExerciseName] = useState("");
  const [clipTargetMuscles, setClipTargetMuscles] = useState("");
  const [clipResistanceType, setClipResistanceType] = useState<AnalyzePayload["userContext"]["resistanceType"]>("unknown");
  const [clipSessionIntent, setClipSessionIntent] = useState<AnalyzePayload["userContext"]["sessionIntent"]>("form_check");
  const [clipNotes, setClipNotes] = useState("");
  const [clipState, setClipState] = useState<"idle" | "loading" | "playing" | "paused" | "ended" | "error">("idle");
  const [clipContextState, setClipContextState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [clipContextProvider, setClipContextProvider] = useState<"gemini" | "heuristic" | null>(null);
  const [clipContextConfidence, setClipContextConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const [clipContextError, setClipContextError] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "processing" | "error">("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordedClipName, setRecordedClipName] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisRunResult | null>(null);
  const [analysisViewMode, setAnalysisViewMode] = useState<"normal" | "sbl_nerd">("normal");
  const [analysisHistory, setAnalysisHistory] = useState<AnalysisHistoryEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatState, setChatState] = useState<"idle" | "running" | "error">("idle");
  const [chatError, setChatError] = useState<string | null>(null);
  const [ttsState, setTtsState] = useState<"idle" | "loading" | "speaking" | "error">("idle");
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [ttsResponse, setTtsResponse] = useState<TtsResponse | null>(null);
  const [tempoTrackState, setTempoTrackState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tempoTrackError, setTempoTrackError] = useState<string | null>(null);
  const [tempoTrackResponse, setTempoTrackResponse] = useState<TempoTrackResponse | null>(null);
  const [liveSessionState, setLiveSessionState] = useState<"idle" | "saving" | "error">("idle");
  const [liveSessionError, setLiveSessionError] = useState<string | null>(null);
  const [liveSessions, setLiveSessions] = useState<LiveSessionRecord[]>([]);
  const [liveCoachPrepState, setLiveCoachPrepState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [liveCoachPrepError, setLiveCoachPrepError] = useState<string | null>(null);
  const [liveCoachContext, setLiveCoachContext] = useState<LiveCoachContextResult | null>(null);
  const [liveCoachConnectionState, setLiveCoachConnectionState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [liveCoachConnectionError, setLiveCoachConnectionError] = useState<string | null>(null);
  const [liveCoachTranscript, setLiveCoachTranscript] = useState<Array<{ role: "assistant" | "system" | "user"; content: string }>>([]);
  const [liveExerciseOverride, setLiveExerciseOverride] = useState("");
  const [liveAutoSnapshotEnabled, setLiveAutoSnapshotEnabled] = useState(false);
  const [liveMicState, setLiveMicState] = useState<"idle" | "requesting" | "live" | "error">("idle");
  const [liveMicError, setLiveMicError] = useState<string | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);

  const recordingSupported = typeof MediaRecorder !== "undefined";
  const browserSpeechSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const convexClient = router.options.context.convexClient;
  const clipExerciseProfile = useMemo(
    () => resolveExerciseMovementProfile(clipExerciseName || clipName),
    [clipExerciseName, clipName],
  );
  const clipUserContext = useMemo<AnalyzePayload["userContext"]>(() => ({
    exerciseName: clipExerciseName.trim() || null,
    targetMuscles: clipTargetMuscles
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6),
    sessionIntent: clipSessionIntent,
    resistanceType: clipResistanceType,
    notes: clipNotes.trim() || null,
  }), [clipExerciseName, clipNotes, clipResistanceType, clipSessionIntent, clipTargetMuscles]);
  const analyzeExerciseName = clipUserContext.exerciseName ?? clipName;

  async function callPoseWorker(message: PoseWorkerRequest, transferables: Transferable[] = []) {
    const worker = poseWorkerRef.current;

    if (!worker) {
      throw new Error("Pose worker is not ready yet.");
    }

    return await new Promise<PoseWorkerResponse>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<PoseWorkerResponse>) => {
        if (event.data.requestId !== message.requestId) {
          return;
        }

        cleanup();
        resolve(event.data);
      };

      const handleError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "Pose worker failed."));
      };

      const cleanup = () => {
        worker.removeEventListener("message", handleMessage as EventListener);
        worker.removeEventListener("error", handleError as EventListener);
      };

      worker.addEventListener("message", handleMessage as EventListener);
      worker.addEventListener("error", handleError as EventListener);
      worker.postMessage(message, transferables);
    });
  }

  function createPoseWorkerRequestId() {
    poseWorkerRequestIdRef.current += 1;
    return `pose-worker-${poseWorkerRequestIdRef.current}`;
  }

  useEffect(() => {
    setAnalysisHistory(loadAnalysisHistory());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function initPoseWorker() {
      try {
        const worker = createPoseWorker();
        poseWorkerRef.current = worker;
        const response = await callPoseWorker({
          type: "INIT",
          requestId: createPoseWorkerRequestId(),
          payload: {
            wasmPath: MEDIAPIPE_WASM_BASE,
            modelAssetPath: "/mediapipe/pose_landmarker_full.task",
            minPoseDetectionConfidence: POSE_WORKER_DETECTION_CONFIDENCE,
            minPosePresenceConfidence: POSE_WORKER_PRESENCE_CONFIDENCE,
            minTrackingConfidence: POSE_WORKER_TRACKING_CONFIDENCE,
          },
        });

        if (cancelled) {
          worker.terminate();
          return;
        }

        if (response.status === "error") {
          throw new Error(response.message);
        }

        setPipelineState("ready");
        setPipelineError(null);
        setStatusMessage("Pose pipeline ready in the worker. Start the camera or load a training clip.");
      } catch (error) {
        const message = summarizeError(
          error instanceof Error ? error.message : "Failed to initialize MediaPipe Pose Landmarker.",
        );
        setPipelineState("error");
        setPipelineError(message);
        setStatusMessage(message);
      }
    }

    void initPoseWorker();

    return () => {
      cancelled = true;

      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }

      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
      }
      if (liveAutoSnapshotTimerRef.current) {
        window.clearInterval(liveAutoSnapshotTimerRef.current);
        liveAutoSnapshotTimerRef.current = null;
      }
      liveMicRecorderRef.current?.stop();
      liveMicRecorderRef.current = null;
      liveMicStreamRef.current?.getTracks().forEach((track) => track.stop());
      liveMicStreamRef.current = null;

      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (clipUrlRef.current) {
        URL.revokeObjectURL(clipUrlRef.current);
        clipUrlRef.current = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      liveSessionRef.current?.close();
      liveSessionRef.current = null;
      poseWorkerRef.current?.terminate();
      poseWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    async function loadExerciseCatalog() {
      if (!convexClient) {
        return;
      }

      try {
        const listRef = makeFunctionReference<"query", Record<string, never>, ExerciseCatalogEntry[]>(
          "exercises:listCatalog",
        );
        setExerciseCatalog(await convexClient.query(listRef, {}));
      } catch {
        setExerciseCatalog(SEEDED_EXERCISE_CATALOG);
      }
    }

    void loadExerciseCatalog();
  }, [convexClient]);

  function findCatalogExercise(name: string) {
    const normalized = name.trim().toLowerCase();

    if (!normalized) {
      return null;
    }

    return exerciseCatalog.find((exercise) => {
      const haystack = `${exercise.name} ${exercise.muscles.join(" ")}`.toLowerCase();
      return haystack.includes(normalized) || normalized.includes(exercise.name.toLowerCase());
    }) ?? null;
  }

  function applyExerciseCatalogSelection(name: string) {
    setClipExerciseName(name);
    const match = findCatalogExercise(name);

    if (!match) {
      return;
    }

    setClipTargetMuscles(match.muscles.join(", "));
    const equipmentNames = match.equipment.join(" ").toLowerCase();
    setClipResistanceType(
      equipmentNames.includes("machine") || equipmentNames.includes("cable")
        ? "machine"
        : equipmentNames.includes("bodyweight")
          ? "bodyweight"
          : "free_weight",
    );
  }

  useEffect(() => {
    async function loadLiveSessions() {
      if (!convexClient) {
        return;
      }

      try {
        const listRef = makeFunctionReference<"query", Record<string, never>, LiveSessionRecord[]>(
          "liveSession:listRecentSessions",
        );
        setLiveSessions(await convexClient.query(listRef, {}));
      } catch {
        // keep analyze page usable if live-session history is not ready yet
      }
    }

    void loadLiveSessions();
  }, [convexClient]);

  const liveAngles = useMemo(() => getLiveAngles(lastLandmarks), [lastLandmarks]);
  const cameraAngle = useMemo(() => detectCameraAngle(lastLandmarks), [lastLandmarks]);
  const frameQuality = useMemo(
    () => evaluateFrameQuality(lastLandmarks, { exerciseName: analyzeExerciseName }),
    [analyzeExerciseName, lastLandmarks],
  );
  const windowQuality = useMemo(
    () => summarizePoseWindow(
      bufferedFrames.map((frame) => evaluateFrameQuality(frame.landmarks, { exerciseName: analyzeExerciseName })),
    ),
    [analyzeExerciseName, bufferedFrames],
  );
  const analyzePayload = useMemo(
    () =>
      buildAnalyzePayload({
        sourceType,
        clipName,
        userContext: clipUserContext,
        bufferedFrames,
        frameQuality,
        windowQuality,
        cameraAngle,
        liveAngles,
      }),
    [bufferedFrames, cameraAngle, clipName, clipUserContext, frameQuality, liveAngles, sourceType, windowQuality],
  );
  const analysisDraft = useMemo(() => createAnalysisDraft(analyzePayload), [analyzePayload]);
  const analysisPreview = useMemo(
    () => analysisResult ?? createLocalAnalysisRun(analyzePayload),
    [analysisResult, analyzePayload],
  );

  const canRunAnalysis =
    analyzePayload.frameStats.sampledFrames > 0 &&
    sourceType !== null &&
    analysisState !== "running";

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
    clipContextRequestIdRef.current += 1;
    clipAutoAnalyzePendingRef.current = false;
    processingRef.current = false;
    liveMicRecorderRef.current?.stop();
    liveMicRecorderRef.current = null;
    liveMicStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveMicStreamRef.current = null;
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    if (liveAutoSnapshotTimerRef.current) {
      window.clearInterval(liveAutoSnapshotTimerRef.current);
      liveAutoSnapshotTimerRef.current = null;
    }
    liveSnapshotInFlightRef.current = false;
    setLastLandmarks([]);
    setVisibleLandmarks(0);
    setFramesProcessed(0);
    setBufferedFrames([]);
    setAnalysisState("idle");
    setAnalysisError(null);
    setAnalysisResult(null);
    setClipContextState("idle");
    setClipContextProvider(null);
    setClipContextConfidence(null);
    setClipContextError(null);
    setChatMessages([]);
    setChatState("idle");
    setChatError(null);
    setTtsState("idle");
    setTtsError(null);
    setTtsResponse(null);
    setLiveCoachPrepState("idle");
    setLiveCoachPrepError(null);
    setLiveCoachContext(null);
    setLiveCoachConnectionState("idle");
    setLiveCoachConnectionError(null);
    setLiveCoachTranscript([]);
    setLiveExerciseOverride("");
    setLiveAutoSnapshotEnabled(false);
    setLiveMicState("idle");
    setLiveMicError(null);
    setVideoAspectRatio(16 / 9);
  }

  function syncVideoAspectRatio() {
    const video = videoRef.current;

    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    setVideoAspectRatio(video.videoWidth / video.videoHeight);
  }

  async function captureCurrentFrameImage() {
    const video = videoRef.current;

    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
      throw new Error("A visible video frame is required before Live coach can inspect the exercise.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to prepare a video frame for Gemini Live.");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) {
          resolve(value);
        } else {
          reject(new Error("Failed to capture the current video frame."));
        }
      }, "image/jpeg", 0.82);
    });

    return { dataUrl, blob };
  }

  function captureVideoFrameDataUrl(video: HTMLVideoElement) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Failed to prepare a video frame for clip context inference.");
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  function waitForVideoSeek(video: HTMLVideoElement, targetTime: number) {
    if (Math.abs(video.currentTime - targetTime) < 0.05) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error("Timed out seeking video for clip context inference."));
      }, 1200);

      const handleSeeked = () => {
        cleanup();
        resolve();
      };

      const handleError = () => {
        cleanup();
        reject(new Error("Failed to seek video for clip context inference."));
      };

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        video.removeEventListener("seeked", handleSeeked);
        video.removeEventListener("error", handleError);
      };

      video.addEventListener("seeked", handleSeeked, { once: true });
      video.addEventListener("error", handleError, { once: true });
      video.currentTime = targetTime;
    });
  }

  async function captureClipInferenceFrames() {
    const video = videoRef.current;

    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0 || video.videoHeight === 0) {
      return [] as string[];
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const originalTime = duration > 0 ? Math.max(0, Math.min(video.currentTime, duration)) : 0;
    const wasPaused = video.paused;
    const targetTimes = duration > 1
      ? [0.12, 0.4, 0.72].map((ratio) => Math.max(0, Math.min(duration * ratio, Math.max(0, duration - 0.05))))
      : [originalTime];
    const uniqueTimes = targetTimes.filter((time, index, values) => values.findIndex((candidate) => Math.abs(candidate - time) < 0.1) === index);
    const frames: string[] = [captureVideoFrameDataUrl(video)];

    video.pause();

    try {
      for (const targetTime of uniqueTimes) {
        await waitForVideoSeek(video, targetTime);
        const frame = captureVideoFrameDataUrl(video);

        if (!frames.includes(frame)) {
          frames.push(frame);
        }
      }

      await waitForVideoSeek(video, originalTime);
    } catch {
      // Keep the current-frame fallback captured above.
    } finally {
      if (!wasPaused) {
        await video.play().catch(() => undefined);
      }
    }

    return frames;
  }

  async function inferUploadedClipContext(fileName: string) {
    const requestId = ++clipContextRequestIdRef.current;
    const hintExerciseName = clipExerciseName.trim();
    const hintTargetMuscles = clipTargetMuscles.trim();
    const hintResistanceType = clipResistanceType;
    const hintSessionIntent = clipSessionIntent;

    setClipContextState("loading");
    setClipContextProvider(null);
    setClipContextConfidence(null);
    setClipContextError(null);

    try {
      const frameDataUrls = await captureClipInferenceFrames();

      if (requestId !== clipContextRequestIdRef.current) {
        return;
      }

      if (!convexClient) {
        const inferredExercise = findCatalogExercise(fileName.replace(/\.[a-z0-9]+$/i, ""));

        if (!hintExerciseName && inferredExercise) {
          applyExerciseCatalogSelection(inferredExercise.name);
        }

        setClipContextState("ready");
        setClipContextProvider("heuristic");
        setClipContextConfidence(inferredExercise ? "medium" : "low");
        return;
      }

      const inferRef = makeFunctionReference<"action", { request: ClipContextInferenceRequest }, ClipContextInferenceResult>(
        "liveCoachContext:inferClipUploadContext",
      );
      const result = await convexClient.action(inferRef, {
        request: {
          fileName,
          frameDataUrls,
        },
      });

      if (requestId !== clipContextRequestIdRef.current) {
        return;
      }

      if (!hintExerciseName && result.inferredExercise) {
        applyExerciseCatalogSelection(result.inferredExercise);
      }

      if (!hintTargetMuscles && result.targetMuscles.length > 0) {
        setClipTargetMuscles(result.targetMuscles.join(", "));
      }

      if (hintResistanceType === "unknown" && result.resistanceType !== "unknown") {
        setClipResistanceType(result.resistanceType);
      }

      if (hintSessionIntent === "form_check" && result.sessionIntent !== "form_check") {
        setClipSessionIntent(result.sessionIntent);
      }

      setClipContextState(result.error ? "error" : "ready");
      setClipContextProvider(result.provider);
      setClipContextConfidence(result.confidence);
      setClipContextError(result.error);
    } catch (error) {
      if (requestId !== clipContextRequestIdRef.current) {
        return;
      }

      setClipContextState("error");
      setClipContextProvider(null);
      setClipContextConfidence(null);
      setClipContextError(error instanceof Error ? error.message : "Failed to infer uploaded clip context.");
    }
  }

  function buildLiveSnapshotPacket() {
    const issues = [...frameQuality.issues, ...windowQuality.primaryIssues].slice(0, 2);
    const phase =
      analyzePayload.repStats.detectedRepCount === 0
        ? "setup"
        : liveAngles.trunkLean !== null && liveAngles.trunkLean > 45
          ? "stretch"
          : liveAngles.trunkLean !== null && liveAngles.trunkLean > 25
            ? "descent"
            : "unknown";

    return createLiveDeltaPacket({
      phase,
      repCount: analyzePayload.repStats.detectedRepCount,
      confidence: analyzePayload.confidence,
      notes: [
        cameraAngle.label !== "unknown" ? `camera ${cameraAngle.label}` : "camera angle still estimating",
        liveAngles.trunkLean !== null ? `trunk lean ${Math.round(liveAngles.trunkLean)} deg` : "trunk angle unavailable",
        ...issues,
      ].slice(0, 4),
    });
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
      if (!clipExerciseName.trim()) {
        const inferredName = file.name.replace(/\.[a-z0-9]+$/i, "");
        const inferredExercise = findCatalogExercise(inferredName);
        if (inferredExercise) {
          applyExerciseCatalogSelection(inferredExercise.name);
        }
      }
      setClipState("loading");
      setRecordingState("idle");
      setPipelineError(null);
      setStatusMessage("Loading training clip and preparing auto-analysis...");

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
      void inferUploadedClipContext(file.name);
      clipAutoAnalyzePendingRef.current = true;

      setClipState("playing");

      if (pipelineState === "ready") {
        startSampling("Training clip loaded. Sampling frames at 5 FPS, then analysis will run automatically.");
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

  async function runAnalysis() {
    const payload = analyzePayload;

    if (!canRunAnalysis) {
      return;
    }

    setAnalysisState("running");
    setAnalysisError(null);
    setStatusMessage("Running analysis from the current buffered pose window...");

    try {
      if (!convexClient) {
        const localResult = createLocalAnalysisRun(payload);
        setAnalysisResult(localResult);
        setAnalysisHistory(appendAnalysisHistory(localResult));
        setChatMessages([createSeedChatMessage(localResult)]);
        setChatState("idle");
        setChatError(null);
        setAnalysisState("done");
        setStatusMessage("Analysis complete using the local fallback path.");
        return;
      }

      const analyzeRef = makeFunctionReference<"action", { payload: AnalyzePayload }, AnalysisRunResult>(
        "analyze:analyzeClip",
      );
      const result = await convexClient.action(analyzeRef, { payload });
      setAnalysisResult(result);
      setAnalysisHistory(appendAnalysisHistory(result));
      setChatMessages([createSeedChatMessage(result)]);
      setChatState("idle");
      setChatError(null);
      setAnalysisState("done");
      setStatusMessage(
        result.provider === "gemini"
          ? "Analysis complete using Gemini-backed scoring."
          : "Analysis complete using the heuristic fallback path.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to run analysis.";
      setAnalysisError(message);
      setAnalysisState("error");

      const localResult = createLocalAnalysisRun(payload);
      setAnalysisResult(localResult);
      setAnalysisHistory(appendAnalysisHistory(localResult));
      setChatMessages([createSeedChatMessage(localResult)]);
      setChatState("idle");
      setStatusMessage("Convex analysis failed, so the page fell back to a local draft.");
    }
  }

  async function sendChatMessage(prompt: string) {
    if (!analysisResult) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: prompt,
      createdAt: Date.now(),
    };
    const nextMessages = [...chatMessages, userMessage];

    setChatMessages(nextMessages);
    setChatState("running");
    setChatError(null);

    try {
      if (!convexClient) {
        const localReply = createLocalChatReply({ analysisResult, prompt });
        setChatMessages([...nextMessages, localReply.message]);
        setChatState("idle");
        return;
      }

      const chatRef = makeFunctionReference<"action", ChatRequest, ChatReply>("chat:coachChat");
      const reply = await convexClient.action(chatRef, {
        analysisResult,
        messages: nextMessages,
        prompt,
      });
      setChatMessages([...nextMessages, reply.message]);
      setChatState("idle");
      setChatError(reply.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Chat failed.";
      const fallback = createLocalChatReply({ analysisResult, prompt });
      setChatMessages([...nextMessages, { ...fallback.message, provider: "heuristic" }]);
      setChatState("error");
      setChatError(message);
    }
  }

  function stopSpeech() {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.currentTime = 0;
      ttsAudioRef.current = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    speechUtteranceRef.current = null;
    setTtsState("idle");
  }

  function speakScript(script: string) {
    if (!browserSpeechSupported) {
      throw new Error("This browser does not support spoken feedback playback.");
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      speechUtteranceRef.current = null;
      setTtsState("idle");
    };
    utterance.onerror = () => {
      speechUtteranceRef.current = null;
      setTtsState("error");
      setTtsError("Browser speech playback failed.");
    };
    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setTtsState("speaking");
  }

  function playAudioUrl(audioUrl: string) {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }

    const audio = new Audio(audioUrl);
    audio.onended = () => {
      ttsAudioRef.current = null;
      setTtsState("idle");
    };
    audio.onerror = () => {
      ttsAudioRef.current = null;
      setTtsState("error");
      setTtsError("Generated audio playback failed.");
    };
    ttsAudioRef.current = audio;
    void audio.play();
    setTtsState("speaking");
  }

  async function playTts() {
    if (!analysisResult) {
      return;
    }

    setTtsState("loading");
    setTtsError(null);

    try {
      let response: TtsResponse;

      if (!convexClient) {
        response = createLocalTtsResponse(analysisResult);
      } else {
        const ttsRef = makeFunctionReference<"action", TtsRequest, TtsResponse>("tts:speakAnalysis");
        response = await convexClient.action(ttsRef, { analysisResult });
      }

      setTtsResponse(response);
      setTtsError(response.error);
      if (response.audioUrl) {
        playAudioUrl(response.audioUrl);
      } else {
        speakScript(response.script);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate spoken feedback.";
      const fallback = createLocalTtsResponse(analysisResult);
      setTtsResponse({ ...fallback, provider: "heuristic", error: message });
      setTtsError(message);

      try {
        speakScript(fallback.script);
      } catch (playbackError) {
        setTtsState("error");
        setTtsError(
          playbackError instanceof Error ? playbackError.message : "Failed to play spoken feedback.",
        );
      }
    }
  }

  async function generateTempoTrack() {
    if (!analysisResult) {
      return;
    }

    setTempoTrackState("loading");
    setTempoTrackError(null);

    try {
      const response = !convexClient
        ? createTempoTrackDraft(analysisResult)
        : await convexClient.action(
          makeFunctionReference<"action", TempoTrackRequest, TempoTrackResponse>(
            "generateTempoTrack:generateTempoTrack",
          ),
          { analysisResult },
        );

      setTempoTrackResponse(response);
      setTempoTrackState(response.status === "failed" ? "error" : "ready");
      setTempoTrackError(response.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tempo track generation failed.";
      setTempoTrackResponse(createTempoTrackDraft(analysisResult));
      setTempoTrackState("error");
      setTempoTrackError(message);
    }
  }

  async function saveLiveSessionHandoff() {
    if (!analysisResult) {
      return;
    }

    setLiveSessionState("saving");
    setLiveSessionError(null);

    try {
      const draft = createLiveSessionDraft(analysisResult, chatMessages);
      const payload: LiveSessionSaveRequest = {
        source: "handoff",
        exercise: clipName,
        summary: draft.summary,
        cues: draft.cues,
        transcript: draft.transcript,
      };

      if (convexClient) {
        const saveRef = makeFunctionReference<"mutation", {
          sessionId: string;
          source: string;
          exercise?: string | null;
          summary: string;
          cues: string[];
          transcript: LiveSessionSaveRequest["transcript"];
          createdAt: number;
          endedAt: number;
        }, string>("liveSession:saveSession");
        const timestamp = Date.now();
        const sessionId = `handoff-${timestamp}`;

        await convexClient.mutation(saveRef, {
          sessionId,
          source: payload.source,
          exercise: payload.exercise,
          summary: payload.summary,
          cues: payload.cues,
          transcript: payload.transcript,
          createdAt: timestamp,
          endedAt: timestamp,
        });

        const listRef = makeFunctionReference<"query", Record<string, never>, LiveSessionRecord[]>(
          "liveSession:listRecentSessions",
        );
        setLiveSessions(await convexClient.query(listRef, {}));
      } else {
        setLiveSessions((current) => [{
          sessionId: `handoff-${Date.now()}`,
          source: payload.source,
          exercise: payload.exercise ?? null,
          summary: payload.summary,
          cues: payload.cues,
          transcript: payload.transcript,
          createdAt: Date.now(),
          endedAt: Date.now(),
        }, ...current].slice(0, 6));
      }

      setLiveSessionState("idle");
    } catch (error) {
      setLiveSessionState("error");
      setLiveSessionError(error instanceof Error ? error.message : "Failed to save live-session handoff.");
    }
  }

  async function persistLiveCoachTranscriptSnapshot() {
    if (!convexClient || liveCoachTranscript.length === 0) {
      return;
    }

    const assistantMessages = liveCoachTranscript.filter((item) => item.role === "assistant");
    if (assistantMessages.length === 0) {
      return;
    }

    const timestamp = Date.now();
    const saveRef = makeFunctionReference<"mutation", {
      sessionId: string;
      source: string;
      exercise?: string | null;
      summary: string;
      cues: string[];
      transcript: LiveSessionSaveRequest["transcript"];
      createdAt: number;
      endedAt: number;
    }, string>("liveSession:saveSession");

    await convexClient.mutation(saveRef, {
      sessionId: `live-${timestamp}`,
      source: "live_api",
      exercise: liveCoachContext?.inferredExercise ?? clipName,
      summary: assistantMessages[assistantMessages.length - 1]?.content ?? "Live coaching session completed.",
      cues: assistantMessages.map((item) => item.content).slice(-3),
      transcript: liveCoachTranscript.map((item, index) => ({
        role: item.role,
        content: item.content,
        timestamp: timestamp + index,
      })),
      createdAt: timestamp,
      endedAt: timestamp,
    });

    const listRef = makeFunctionReference<"query", Record<string, never>, LiveSessionRecord[]>(
      "liveSession:listRecentSessions",
    );
    setLiveSessions(await convexClient.query(listRef, {}));
  }

  function disconnectLiveCoach() {
    liveMicRecorderRef.current?.stop();
    liveMicRecorderRef.current = null;
    liveMicStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveMicStreamRef.current = null;
    setLiveMicState("idle");
    setLiveMicError(null);
    void persistLiveCoachTranscriptSnapshot();
    liveSessionRef.current?.close();
    liveSessionRef.current = null;
    setLiveCoachConnectionState("idle");
    setLiveCoachConnectionError(null);
  }

  function speakLiveCoachMessage(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    speechUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  async function startLiveMic() {
    const session = liveSessionRef.current;

    if (!session) {
      setLiveMicState("error");
      setLiveMicError("Start the Gemini Live session before turning on the mic.");
      return;
    }

    if (liveMicState === "live") {
      return;
    }

    setLiveMicState("requesting");
    setLiveMicError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
      const recorder = mimeType.length > 0
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      liveMicStreamRef.current = stream;
      liveMicRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        const activeSession = liveSessionRef.current;

        if (!activeSession || event.data.size === 0) {
          return;
        }

        const audioBlob = event.data as unknown as Parameters<Session["sendRealtimeInput"]>[0]["audio"];
        activeSession.sendRealtimeInput({ audio: audioBlob });
      };
      recorder.onerror = () => {
        setLiveMicState("error");
        setLiveMicError("Microphone streaming failed.");
      };
      recorder.onstop = () => {
        const activeSession = liveSessionRef.current;
        if (activeSession) {
          activeSession.sendRealtimeInput({ audioStreamEnd: true });
        }
      };
      recorder.start(450);
      setLiveMicState("live");
    } catch (error) {
      setLiveMicState("error");
      setLiveMicError(error instanceof Error ? error.message : "Failed to start microphone input.");
    }
  }

  function stopLiveMic() {
    liveMicRecorderRef.current?.stop();
    liveMicRecorderRef.current = null;
    liveMicStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveMicStreamRef.current = null;
    setLiveMicState("idle");
    setLiveMicError(null);
  }

  async function fetchLiveCoachContext() {
    if (!convexClient) {
      throw new Error("Convex is not configured, so Gemini Live prep is unavailable.");
    }
    const frame = await captureCurrentFrameImage();
    const snapshotPacket = buildLiveSnapshotPacket();
    const request: LiveCoachContextRequest = {
      userHint: liveExerciseOverride.trim() || clipName || undefined,
      frameDataUrls: [frame.dataUrl],
      phaseNotes: snapshotPacket.notes,
    };
    const prepareRef = makeFunctionReference<"action", { request: LiveCoachContextRequest }, LiveCoachContextResult>(
      "liveCoachContext:prepareLiveCoachContext",
    );
    return await convexClient.action(prepareRef, { request });
  }

  async function prepareLiveCoach() {
    setLiveCoachPrepState("loading");
    setLiveCoachPrepError(null);

    try {
      const context = await fetchLiveCoachContext();
      setLiveCoachContext(context);
      setLiveCoachPrepState("ready");
      setLiveCoachPrepError(context.error);
      setLiveCoachTranscript([{
        role: "system" as const,
        content: `Prepared live coaching context for ${context.inferredExercise ?? "an unknown exercise"}.`,
      }]);
    } catch (error) {
      setLiveCoachPrepState("error");
      setLiveCoachPrepError(error instanceof Error ? error.message : "Failed to prepare Gemini Live coaching context.");
    }
  }

  async function connectLiveCoach() {
    if (!convexClient) {
      setLiveCoachConnectionState("error");
      setLiveCoachConnectionError("Convex is not configured, so Gemini Live is unavailable.");
      return;
    }

    setLiveCoachConnectionState("connecting");
    setLiveCoachConnectionError(null);

    try {
      const resolvedContext = liveCoachContext ?? await fetchLiveCoachContext();

      if (!resolvedContext) {
        throw new Error("Prepare the live coach context before opening Gemini Live.");
      }

      setLiveCoachContext(resolvedContext);
      setLiveCoachPrepState("ready");
      setLiveCoachPrepError(resolvedContext.error);

      const tokenRef = makeFunctionReference<"action", { request: LiveAuthTokenRequest }, LiveAuthTokenResult>(
        "liveTokens:createLiveAuthToken",
      );
      const tokenResult = await convexClient.action(tokenRef, {
        request: { context: resolvedContext },
      });

      if (!tokenResult.tokenName) {
        throw new Error(tokenResult.error ?? "Gemini Live token was not created.");
      }

      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: tokenResult.tokenName, apiVersion: "v1alpha" });
      const session = await ai.live.connect({
        model: tokenResult.model,
        callbacks: {
          onopen: () => {
            setLiveCoachConnectionState("connected");
            liveAssistantBufferRef.current = "";
            setLiveCoachTranscript((current) => [
              ...current,
              {
                role: "system" as const,
                content: `Gemini Live connected for ${resolvedContext.inferredExercise ?? "the current exercise"}.`,
              },
            ]);
          },
          onmessage: (message) => {
            const inputTranscription = message.serverContent?.inputTranscription;
            const transcribedInput = inputTranscription?.text?.trim();
            if (inputTranscription?.finished && transcribedInput) {
              setLiveCoachTranscript((current) => [
                ...current,
                { role: "user" as const, content: transcribedInput },
              ].slice(-16));
            }

            const text = message.text?.trim();
            if (text) {
              liveAssistantBufferRef.current = `${liveAssistantBufferRef.current} ${text}`.trim();
            }

            if (message.serverContent?.turnComplete && liveAssistantBufferRef.current) {
              const completedMessage = liveAssistantBufferRef.current;
              liveAssistantBufferRef.current = "";
              setLiveCoachTranscript((current) => [
                ...current,
                { role: "assistant" as const, content: completedMessage },
              ].slice(-16));
              speakLiveCoachMessage(completedMessage);
            }
          },
          onerror: (event) => {
            setLiveCoachConnectionState("error");
            setLiveCoachConnectionError(event.message || "Gemini Live connection failed.");
          },
          onclose: () => {
            stopLiveMic();
            liveSessionRef.current = null;
            setLiveCoachConnectionState("idle");
          },
        },
      });

      liveSessionRef.current = session;
      const hydratedContext = createHydratedLivePromptBudget(resolvedContext);
      session.sendClientContent({
        turns: `Session context: ${JSON.stringify(hydratedContext)}. Wait for incoming snapshots and reply with one short coaching cue when the user asks for a snapshot assessment.`,
        turnComplete: true,
      });
    } catch (error) {
      liveSessionRef.current?.close();
      liveSessionRef.current = null;
      setLiveCoachConnectionState("error");
      setLiveCoachConnectionError(error instanceof Error ? error.message : "Failed to connect Gemini Live.");
    }
  }

  async function sendLiveSnapshot() {
    const session = liveSessionRef.current;

    if (!session) {
      setLiveCoachConnectionError("Start the Gemini Live session before sending a snapshot.");
      return;
    }

    if (liveSnapshotInFlightRef.current) {
      return;
    }

    liveSnapshotInFlightRef.current = true;

    try {
      const frame = await captureCurrentFrameImage();
      const snapshotPacket = buildLiveSnapshotPacket();
      const videoBlob = frame.blob as unknown as Parameters<Session["sendRealtimeInput"]>[0]["video"];
      session.sendRealtimeInput({
        video: videoBlob,
        text: JSON.stringify(snapshotPacket),
      });
      session.sendClientContent({
        turns: "Assess the latest visible rep state and return the single most useful cue in one short sentence.",
        turnComplete: true,
      });
    } catch (error) {
      setLiveCoachConnectionState("error");
      setLiveCoachConnectionError(error instanceof Error ? error.message : "Failed to send a live coaching snapshot.");
    } finally {
      liveSnapshotInFlightRef.current = false;
    }
  }

  useEffect(() => {
    if (liveCoachConnectionState !== "connected" || !liveAutoSnapshotEnabled) {
      if (liveAutoSnapshotTimerRef.current) {
        window.clearInterval(liveAutoSnapshotTimerRef.current);
        liveAutoSnapshotTimerRef.current = null;
      }
      return;
    }

    if (liveAutoSnapshotTimerRef.current) {
      window.clearInterval(liveAutoSnapshotTimerRef.current);
    }

    liveAutoSnapshotTimerRef.current = window.setInterval(() => {
      void sendLiveSnapshot();
    }, 2000);

    return () => {
      if (liveAutoSnapshotTimerRef.current) {
        window.clearInterval(liveAutoSnapshotTimerRef.current);
        liveAutoSnapshotTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveAutoSnapshotEnabled, liveCoachConnectionState]);

  async function captureFrame() {
    const video = videoRef.current;
    const worker = poseWorkerRef.current;

    if (processingRef.current || !video || !worker || pipelineState !== "ready") {
      return;
    }

    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) {
      return;
    }

    processingRef.current = true;

    try {
      const image = await createImageBitmap(video);
      const response = await callPoseWorker({
        type: "DETECT_FRAME",
        requestId: createPoseWorkerRequestId(),
        payload: {
          image,
          timestampMs: performance.now(),
        },
      }, [image]);

      if (response.status === "error") {
        throw new Error(response.message);
      }

      if (response.status !== "frame") {
        throw new Error("Pose worker returned an unexpected frame response.");
      }

      const landmarks = response.landmarks;
      const nextVisibleLandmarks = response.visibleLandmarks;

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState, clipState, pipelineState, sourceType]);

  useEffect(() => {
    const shouldAutoAnalyze =
      sourceType === "clip" &&
      clipAutoAnalyzePendingRef.current &&
      analysisState === "idle" &&
      bufferedFrames.length > 0 &&
      (bufferedFrames.length >= MIN_AUTO_ANALYZE_FRAMES || clipState === "ended");

    if (!shouldAutoAnalyze) {
      return;
    }

    clipAutoAnalyzePendingRef.current = false;
    void runAnalysis();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisState, bufferedFrames.length, clipState, sourceType]);

  const readinessTone =
    frameQuality.readiness === "ready"
      ? "bg-emerald-50 text-emerald-700"
      : frameQuality.readiness === "adjusting"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700";

  const analysisTone =
    frameQuality.analysisReadiness === "full"
      ? "bg-emerald-50 text-emerald-700"
      : frameQuality.analysisReadiness === "best_effort"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700";

  const windowAnalysisTone =
    windowQuality.analysisReadiness === "full"
      ? "bg-emerald-50 text-emerald-700"
      : windowQuality.analysisReadiness === "best_effort"
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700";

  const showDemoGuide = sourceType === null && analysisState === "idle";

  return (
    <div className="space-y-6 pb-28 lg:pb-0">
      {/* ─── Action bar ─── */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { void startCamera(); }}
          disabled={cameraState === "starting" || cameraState === "live"}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#4f46e5]/20 transition hover:shadow-xl active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start live test
        </button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--outline)] bg-white px-6 py-3 text-sm font-medium text-[var(--ink)] shadow-[var(--shadow-sm)] transition hover:bg-[var(--surface-2)]">
          Upload clip
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
          onClick={() => { void startRecording(); }}
          disabled={
            !recordingSupported ||
            sourceType !== "camera" ||
            cameraState !== "live" ||
            recordingState === "recording" ||
            recordingState === "processing"
          }
          className="rounded-full border border-[var(--outline)] bg-[var(--accent-light)] px-6 py-3 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Record
        </button>
        <button
          type="button"
          onClick={stopRecording}
          disabled={recordingState !== "recording"}
          className="rounded-full border border-[var(--outline)] bg-white px-6 py-3 text-sm font-medium text-[var(--ink)] shadow-[var(--shadow-sm)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop rec
        </button>
        <button
          type="button"
          onClick={() => { void runAnalysis(); }}
          disabled={!canRunAnalysis}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-hover)] px-6 py-3 text-sm font-medium text-white shadow-lg shadow-[#4338ca]/20 transition hover:shadow-xl active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run analysis
        </button>
        <button
          type="button"
          onClick={stopCamera}
          disabled={sourceType === null}
          className="rounded-full border border-[var(--outline)] bg-white px-6 py-3 text-sm font-medium text-[var(--ink)] shadow-[var(--shadow-sm)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop
        </button>
      </div>

      {/* ─── Status message ─── */}
      <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">{statusMessage}</p>

      {sourceType === "clip" ? (
        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-[var(--ink)]">Uploaded clip context</h3>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Add exercise details here so the analysis does not have to infer everything from the filename or clip alone.
              </p>
              {clipContextState === "loading" ? (
                <p className="mt-2 text-xs font-medium text-[var(--accent)]">
                  Inferring exercise context from the uploaded clip with Gemini...
                </p>
              ) : null}
              {clipContextState === "ready" && clipContextProvider ? (
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Auto-filled with {clipContextProvider === "gemini" ? "Gemini clip inference" : "filename heuristics"}
                  {clipContextConfidence ? ` (${clipContextConfidence} confidence)` : ""}.
                </p>
              ) : null}
              {clipContextError ? (
                <p className="mt-2 text-xs text-amber-700">
                  Clip inference fallback: {clipContextError}
                </p>
              ) : null}
            </div>
            <div className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
              {clipExerciseProfile.pattern} focus
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <label className="space-y-2 text-sm text-[var(--ink-secondary)]">
              <span className="font-medium text-[var(--ink)]">Exercise</span>
              <input
                list="analyze-exercise-options"
                value={clipExerciseName}
                onChange={(event) => setClipExerciseName(event.target.value)}
                placeholder="SLDL, squat, RDL..."
                className="w-full rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
              <datalist id="analyze-exercise-options">
                {exerciseCatalog.map((exercise) => (
                  <option key={exercise.name} value={exercise.name} />
                ))}
              </datalist>
              {exerciseCatalog.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {exerciseCatalog.slice(0, 8).map((exercise) => (
                    <button
                      key={exercise.name}
                      type="button"
                      onClick={() => applyExerciseCatalogSelection(exercise.name)}
                      className="rounded-full border border-[var(--outline)] bg-[var(--surface-2)] px-3 py-1 text-xs font-medium text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                    >
                      {exercise.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </label>

            <label className="space-y-2 text-sm text-[var(--ink-secondary)]">
              <span className="font-medium text-[var(--ink)]">Target muscles</span>
              <input
                value={clipTargetMuscles}
                onChange={(event) => setClipTargetMuscles(event.target.value)}
                placeholder="Hamstrings, erectors"
                className="w-full rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>

            <label className="space-y-2 text-sm text-[var(--ink-secondary)]">
              <span className="font-medium text-[var(--ink)]">Resistance type</span>
              <select
                value={clipResistanceType}
                onChange={(event) => setClipResistanceType(event.target.value as AnalyzePayload["userContext"]["resistanceType"])}
                className="w-full rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="unknown">Unknown</option>
                <option value="bodyweight">Bodyweight</option>
                <option value="free_weight">Free weight</option>
                <option value="machine">Machine / cable</option>
              </select>
            </label>

            <label className="space-y-2 text-sm text-[var(--ink-secondary)]">
              <span className="font-medium text-[var(--ink)]">Session intent</span>
              <select
                value={clipSessionIntent}
                onChange={(event) => setClipSessionIntent(event.target.value as AnalyzePayload["userContext"]["sessionIntent"])}
                className="w-full rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              >
                <option value="form_check">Form check</option>
                <option value="work_set">Work set</option>
                <option value="demo">Demo / showcase</option>
              </select>
            </label>

            <label className="space-y-2 text-sm text-[var(--ink-secondary)] lg:col-span-2">
              <span className="font-medium text-[var(--ink)]">Clip notes</span>
              <textarea
                value={clipNotes}
                onChange={(event) => setClipNotes(event.target.value)}
                rows={3}
                placeholder="Example: barbell SLDL, goal is hamstrings + erectors, plates partially block the shins in the bottom third."
                className="w-full rounded-2xl border border-[var(--outline)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent)]"
              />
            </label>
          </div>
        </div>
      ) : null}

      {/* ─── Demo guide ─── */}
      {showDemoGuide ? (
        <div className="rounded-[28px] bg-[#f0f4ff] p-6 ring-1 ring-[var(--outline)]">
          <h2 className="text-lg font-medium text-[var(--ink)]">Quick start</h2>
          <p className="mt-1.5 text-sm text-[var(--ink-secondary)]">Fastest path for a booth demo or self-test.</p>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              ["1", "Load a clip", "Upload a training clip or start the live camera."],
              ["2", "Run analysis", "Let the pose window build, then click Run analysis."],
              ["3", "Review & chat", "Check scorecards, progress, and coaching chat."],
            ].map(([step, title, text]) => (
              <div key={step} className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-semibold text-white">
                  {step}
                </div>
                <p className="mt-3 text-sm font-medium text-[var(--ink)]">{title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-secondary)]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* ─── Video + diagnostics ─── */}
      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-2xl bg-white p-4 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <div className="relative overflow-hidden rounded-xl bg-[#0f172a]">
            <div
              className="relative w-full"
              style={{
                transform: "scaleX(-1)",
                aspectRatio: `${videoAspectRatio}`,
              }}
            >
              <video
                ref={videoRef}
                className="absolute inset-0 h-full w-full object-cover"
                autoPlay
                muted
                playsInline
                controls={sourceType === "clip"}
                preload="auto"
                onLoadedMetadata={syncVideoAspectRatio}
                onPlay={() => {
                  syncVideoAspectRatio();
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
            <div className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur">
              {recordingState === "recording"
                ? `recording ${recordingDuration}s`
                : sourceType === "clip"
                  ? clipState
                  : cameraState}
            </div>
            <div className="absolute bottom-3 left-3 rounded-xl bg-black/60 px-3 py-2 text-xs text-white backdrop-blur">
              {visibleLandmarks > 0 ? `${visibleLandmarks} landmarks visible` : "No pose landmarks yet"}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <h3 className="text-sm font-medium text-[var(--ink)]">Pose diagnostics</h3>
          <div className="mt-4 space-y-2.5">
            {pipelineError ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {pipelineError}
              </div>
            ) : null}
            <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${readinessTone}`}>
              {frameQuality.guidance}
            </div>
            <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${analysisTone}`}>
              {frameQuality.analysisReason}
            </div>
            {[
              ["Pipeline", pipelineState],
              ["Source", sourceType ?? "none"],
              [sourceType === "clip" ? "Clip" : "Camera", sourceType === "clip" ? clipState : cameraState],
              ["Recording", recordingState],
              ["Rec. seconds", String(recordingDuration)],
              ["Analysis", analysisState],
              ["Mode", frameQuality.analysisReadiness],
              ["Frames", String(framesProcessed)],
              ["Landmarks", String(visibleLandmarks)],
              ["Camera angle", cameraAngle.label],
              ["Buffered", String(bufferedFrames.length)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-xl bg-[var(--surface-2)] px-3.5 py-2.5 text-sm"
              >
                <span className="font-medium text-[var(--ink)]">{label}</span>
                <span className="text-[var(--ink-muted)]">{value}</span>
              </div>
            ))}
            <div className="rounded-xl bg-[var(--surface-2)] px-3.5 py-3 text-sm text-[var(--ink-secondary)]">
              <p className="font-medium text-[var(--ink)]">Camera guidance</p>
              <p className="mt-1.5">{cameraAngle.guidance}</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                width: {cameraAngle.widthRatio ?? "-"} | depth: {cameraAngle.depthRatio ?? "-"}
              </p>
              {clipName ? <p className="mt-1 text-xs text-[var(--ink-muted)]">clip: {clipName}</p> : null}
              {clipUserContext.exerciseName ? <p className="mt-1 text-xs text-[var(--ink-muted)]">exercise: {clipUserContext.exerciseName}</p> : null}
              {clipUserContext.targetMuscles.length > 0 ? <p className="mt-1 text-xs text-[var(--ink-muted)]">targets: {clipUserContext.targetMuscles.join(", ")}</p> : null}
              {recordedClipName ? <p className="mt-1 text-xs text-[var(--ink-muted)]">last rec: {recordedClipName}</p> : null}
            </div>
            {recordingError ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {recordingError}
              </div>
            ) : null}
            {analysisError ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
                {analysisError}
              </div>
            ) : null}
            {frameQuality.issues.length > 0 ? (
              <div className="rounded-xl bg-[var(--surface-2)] px-3.5 py-3 text-sm text-[var(--ink-secondary)]">
                <p className="font-medium text-[var(--ink)]">Quick fixes</p>
                <ul className="mt-1.5 space-y-1">
                  {frameQuality.issues.map((issue) => (
                    <li key={issue} className="flex items-start gap-2">
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-4 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
        <div>
          <p className="text-sm font-medium text-[var(--ink)]">Analysis mode</p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Normal keeps the coaching simple. SBL Nerd shows the deeper breakdown.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-[var(--outline)] bg-[var(--surface-2)] p-1">
          {[
            ["normal", "Normal"],
            ["sbl_nerd", "SBL Nerd"],
          ].map(([value, label]) => {
            const active = analysisViewMode === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setAnalysisViewMode(value as "normal" | "sbl_nerd")}
                className={active
                  ? "rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white shadow-sm"
                  : "rounded-full px-4 py-2 text-sm font-medium text-[var(--ink-secondary)] transition hover:text-[var(--accent)]"
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Angles + Reps ─── */}
      {analysisViewMode === "sbl_nerd" ? (
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <h3 className="text-sm font-medium text-[var(--ink)]">Live joint reads</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {liveAngles.metrics.map((metric) => (
              <div key={metric.label} className="rounded-xl bg-[var(--surface-2)] px-4 py-3.5">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">{metric.label}</p>
                <p className="mt-1.5 text-2xl font-medium text-[var(--accent)]">
                  {metric.value === null ? "--" : `${metric.value}${metric.unit}`}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <h3 className="text-sm font-medium text-[var(--ink)]">Rep segmentation</h3>
          <div className="mt-4 space-y-2.5">
            {[
              ["Detected reps", String(analyzePayload.repStats.detectedRepCount)],
              ["Avg rep duration", analyzePayload.repStats.averageRepDurationMs === null ? "--" : `${analyzePayload.repStats.averageRepDurationMs}ms`],
              ["Avg bottom knee", analyzePayload.repStats.averageBottomKneeAngle === null ? "--" : `${analyzePayload.repStats.averageBottomKneeAngle}deg`],
              ["Avg primary metric", analyzePayload.repStats.averageBottomPrimaryMetricValue === null ? "--" : `${analyzePayload.repStats.averageBottomPrimaryMetricValue}deg`],
              ["Primary metric", analyzePayload.repStats.primaryMetric],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-xl bg-[var(--surface-2)] px-3.5 py-2.5 text-sm">
                <span className="font-medium text-[var(--ink)]">{label}</span>
                <span className="text-[var(--ink-muted)]">{value}</span>
              </div>
            ))}
            {analyzePayload.reps.length > 0 ? (
              <div className="rounded-xl bg-[var(--surface-2)] px-3.5 py-3 text-sm text-[var(--ink-secondary)]">
                <p className="font-medium text-[var(--ink)]">Rep breakdown</p>
                <ul className="mt-1.5 space-y-1">
                  {analyzePayload.reps.map((rep) => (
                    <li key={rep.repNumber} className="flex items-start gap-2">
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      {`Rep ${rep.repNumber}: ${rep.durationMs}ms, bottom ${rep.bottomPrimaryMetricValue ?? rep.bottomKneeAngle ?? "--"}deg, ${rep.confidence}`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      ) : null}

      {/* ─── Analysis results ─── */}
      <AnalysisResultsPanel result={analysisPreview} isPreview={!analysisResult} viewMode={analysisViewMode} />

      <TtsPanel
        canSpeak={Boolean(analysisResult)}
        ttsState={ttsState}
        ttsError={ttsError}
        lastResponse={ttsResponse}
        onSpeak={playTts}
        onStop={stopSpeech}
      />

      <TempoTrackPanel
        canGenerate={Boolean(analysisResult)}
        trackState={tempoTrackState}
        trackError={tempoTrackError}
        response={tempoTrackResponse}
        onGenerate={generateTempoTrack}
      />

      <LiveCoachPanel
        canPrepare={sourceType !== null}
        prepState={liveCoachPrepState}
        prepError={liveCoachPrepError}
        context={liveCoachContext}
        exerciseOverride={liveExerciseOverride}
        onExerciseOverrideChange={setLiveExerciseOverride}
        connectionState={liveCoachConnectionState}
        connectionError={liveCoachConnectionError}
        transcript={liveCoachTranscript}
        autoSnapshotEnabled={liveAutoSnapshotEnabled}
        onToggleAutoSnapshots={() => setLiveAutoSnapshotEnabled((current) => !current)}
        micState={liveMicState}
        micError={liveMicError}
        onStartMic={startLiveMic}
        onStopMic={stopLiveMic}
        onPrepare={prepareLiveCoach}
        onConnect={connectLiveCoach}
        onDisconnect={disconnectLiveCoach}
        onSendSnapshot={sendLiveSnapshot}
      />

      <LiveSessionPanel
        canSave={Boolean(analysisResult)}
        saveState={liveSessionState}
        saveError={liveSessionError}
        sessions={liveSessions}
        onSave={saveLiveSessionHandoff}
      />

      {/* ─── Progress + Chat side by side ─── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ProgressHistoryPanel history={analysisHistory} />

        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <h3 className="text-sm font-medium text-[var(--ink)]">Coaching chat</h3>
          <div className="mt-4">
            <ChatPanel
              analysisResult={analysisResult}
              messages={chatMessages}
              chatState={chatState}
              chatError={chatError}
              onSend={sendChatMessage}
            />
          </div>
        </div>
      </div>

      {/* ─── Debug panels ─── */}
      {analysisViewMode === "sbl_nerd" ? (
      <details className="group">
        <summary className="cursor-pointer text-sm font-medium text-[var(--ink-muted)] transition hover:text-[var(--ink)]">
          Debug panels
        </summary>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {[
            { title: "Analysis result JSON", data: analysisResult },
            { title: "Gemini handoff payload", data: analyzePayload },
            { title: "Backend fallback draft", data: analysisDraft },
          ].map((panel) => (
            <div key={panel.title} className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
              <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">{panel.title}</h4>
              <div className="mt-3 rounded-xl bg-[var(--surface-2)] p-3">
                <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--ink-muted)]">
                  {JSON.stringify(panel.data, null, 2)}
                </pre>
              </div>
            </div>
          ))}

          <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
            <h4 className="text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">Phase readiness</h4>
            <div className="mt-3 space-y-2">
              <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${windowAnalysisTone}`}>
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
                <div key={label} className="flex items-center justify-between rounded-xl bg-[var(--surface-2)] px-3.5 py-2.5 text-sm">
                  <span className="font-medium text-[var(--ink)]">{label}</span>
                  <span className="text-[var(--ink-muted)]">{value}</span>
                </div>
              ))}
              {windowQuality.primaryIssues.length > 0 ? (
                <div className="rounded-xl bg-[var(--surface-2)] px-3.5 py-3 text-sm text-[var(--ink-secondary)]">
                  <p className="font-medium text-[var(--ink)]">Window-level blockers</p>
                  <ul className="mt-1.5 space-y-1">
                    {windowQuality.primaryIssues.map((issue) => (
                      <li key={issue} className="flex items-start gap-2">
                        <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </details>
      ) : null}

      {/* ─── Mobile bottom bar ─── */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--outline)] bg-white/95 px-4 py-3 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <button
            type="button"
            onClick={() => { void startCamera(); }}
            disabled={cameraState === "starting" || cameraState === "live"}
            className="flex-1 rounded-full bg-[var(--accent)] px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            Camera
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 rounded-full border border-[var(--outline)] bg-white px-4 py-3 text-sm font-medium text-[var(--ink)] transition hover:bg-[var(--surface-2)]"
          >
            Clip
          </button>
          <button
            type="button"
            onClick={() => { void runAnalysis(); }}
            disabled={!canRunAnalysis}
            className="flex-1 rounded-full bg-[var(--accent-hover)] px-4 py-3 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-40"
          >
            Analyze
          </button>
        </div>
      </div>
    </div>
  );
}
