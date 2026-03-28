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
