import type { CompactAnalysisEvidence, LivePromptBudget } from "./analysis-contract";
import type { ChatMessage } from "./chat-contract";

export type LiveSessionTranscriptTurn = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
};

export type LiveSessionRecord = {
  sessionId: string;
  source: "live_api" | "handoff";
  exercise: string | null;
  summary: string;
  cues: string[];
  transcript: LiveSessionTranscriptTurn[];
  createdAt: number;
  endedAt: number;
};

export type LiveSessionSaveRequest = {
  source: "live_api" | "handoff";
  exercise?: string | null;
  summary: string;
  cues: string[];
  transcript: LiveSessionTranscriptTurn[];
};

export type LiveSessionPanelDraft = {
  summary: string;
  cues: string[];
  transcript: LiveSessionTranscriptTurn[];
};

export type LiveSessionChatMessage = Pick<ChatMessage, "role" | "content" | "createdAt">;

export type LiveCoachContextRequest = {
  userHint?: string;
  frameDataUrls?: string[];
  phaseNotes?: string[];
};

export type LiveCoachContextResult = {
  inferredExercise: string | null;
  confidence: "high" | "medium" | "low";
  targetMuscles: string[];
  guardrails: string[];
  evidence: CompactAnalysisEvidence[];
  sessionOpenContext: LivePromptBudget["sessionOpenContext"];
  candidateExercises: string[];
  error: string | null;
};

export type LiveAuthTokenRequest = {
  context: LiveCoachContextResult;
};

export type LiveAuthTokenResult = {
  tokenName: string | null;
  model: string;
  expiresAt: string | null;
  error: string | null;
};
