import type { AnalysisRunResult } from "./analysis-contract";
import type { LiveSessionChatMessage, LiveSessionPanelDraft } from "./live-session-contract";

export function createLiveSessionDraft(
  analysisResult: AnalysisRunResult | null,
  chatMessages: LiveSessionChatMessage[],
): LiveSessionPanelDraft {
  const transcript = [
    ...(analysisResult
      ? [{ role: "system" as const, content: analysisResult.summary, timestamp: Date.now() }]
      : []),
    ...chatMessages.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.createdAt,
    })),
  ];

  return {
    summary: analysisResult?.summary ?? "No live summary captured yet.",
    cues: analysisResult?.draft.cues.map((cue) => cue.cue).slice(0, 3) ?? [],
    transcript,
  };
}
