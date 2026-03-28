import type { AnalysisRunResult, AnalyzeConfidence, LivePromptBudget } from "./analysis-contract";
import type { LiveCoachContextResult, LiveSessionChatMessage, LiveSessionPanelDraft } from "./live-session-contract";

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

export function createLivePromptBudget(
  exercise: string,
  targetMuscles: string[],
  guardrails: string[],
): LivePromptBudget["sessionOpenContext"] {
  return {
    exercise,
    targetMuscles,
    coachingStyle: "short, actionable, booth-demo friendly",
    guardrails: guardrails.slice(0, 5),
  };
}

export function createLiveDeltaPacket(params: {
  phase: LivePromptBudget["deltaPacket"]["phase"];
  repCount: number | null;
  confidence: AnalyzeConfidence;
  notes: string[];
}): LivePromptBudget["deltaPacket"] {
  return {
    phase: params.phase,
    repCount: params.repCount,
    confidence: params.confidence,
    notes: params.notes.slice(0, 4),
  };
}

export function createHydratedLivePromptBudget(context: LiveCoachContextResult) {
  return createLivePromptBudget(
    context.inferredExercise ?? "Unknown exercise",
    context.targetMuscles,
    context.guardrails,
  );
}
