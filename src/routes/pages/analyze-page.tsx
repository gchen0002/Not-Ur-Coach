import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { useRouter } from "@tanstack/react-router";
import { makeFunctionReference } from "convex/server";
import { AnalysisResultsPanel } from "@/components/analyze/analysis-results-panel";
import { ChatPanel } from "@/components/analyze/chat-panel";
import { LiveSessionPanel } from "@/components/analyze/live-session-panel";
import { ProgressHistoryPanel } from "@/components/analyze/progress-history-panel";
import { TempoTrackPanel } from "@/components/analyze/tempo-track-panel";
import { TtsPanel } from "@/components/analyze/tts-panel";
import { appendAnalysisHistory, loadAnalysisHistory } from "@/lib/analysis-history";
import { buildAnalyzePayload, type BufferedPoseFrame } from "@/lib/analysis-payload";
import { createAnalysisDraft, createLocalAnalysisRun } from "@/lib/analysis-draft";
import type { AnalysisHistoryEntry, AnalysisRunResult, AnalyzePayload } from "@/lib/analysis-contract";
import type { ChatMessage, ChatReply, ChatRequest } from "@/lib/chat-contract";
import { createLocalChatReply } from "@/lib/chat-draft";
import { createLiveSessionDraft } from "@/lib/live-session";
import type { LiveSessionRecord, LiveSessionSaveRequest } from "@/lib/live-session-contract";
import type { TempoTrackRequest, TempoTrackResponse } from "@/lib/tempo-track-contract";
import type { TtsRequest, TtsResponse } from "@/lib/tts-contract";
import { createTempoTrackDraft } from "@/lib/tempo-track-draft";
import { createLocalTtsResponse } from "@/lib/tts-draft";
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
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
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
  const [clipState, setClipState] = useState<"idle" | "loading" | "playing" | "paused" | "ended" | "error">("idle");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "processing" | "error">("idle");
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordedClipName, setRecordedClipName] = useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisRunResult | null>(null);
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
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);

  const recordingSupported = typeof MediaRecorder !== "undefined";
  const browserSpeechSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const convexClient = router.options.context.convexClient;

  useEffect(() => {
    setAnalysisHistory(loadAnalysisHistory());
  }, []);

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
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

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
    processingRef.current = false;
    setLastLandmarks([]);
    setVisibleLandmarks(0);
    setFramesProcessed(0);
    setBufferedFrames([]);
    setAnalysisState("idle");
    setAnalysisError(null);
    setAnalysisResult(null);
    setChatMessages([]);
    setChatState("idle");
    setChatError(null);
    setTtsState("idle");
    setTtsError(null);
    setTtsResponse(null);
    setVideoAspectRatio(16 / 9);
  }

  function syncVideoAspectRatio() {
    const video = videoRef.current;

    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    setVideoAspectRatio(video.videoWidth / video.videoHeight);
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
  }, [cameraState, clipState, pipelineState, sourceType, startSampling, stopSampling]);

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

      {/* ─── Angles + Reps ─── */}
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
                      {`Rep ${rep.repNumber}: ${rep.durationMs}ms, bottom ${rep.bottomKneeAngle ?? "--"}deg, ${rep.confidence}`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* ─── Analysis results ─── */}
      <AnalysisResultsPanel result={analysisPreview} isPreview={!analysisResult} />

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
