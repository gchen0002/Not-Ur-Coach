import type { AnalysisRunResult } from "@/lib/analysis-contract";
import type { ChatMessage, ChatReply } from "@/lib/chat-contract";

function pickTopCue(result: AnalysisRunResult) {
  return result.draft.cues[0]?.cue ?? result.draft.nextStep;
}

function buildResponse(result: AnalysisRunResult, prompt: string) {
  const normalized = prompt.toLowerCase();
  const score = result.draft.scores.overall;
  const topCue = pickTopCue(result);
  const mainFix = result.draft.basicAnalysis.whatToFix[0] ?? "Keep more of the body visible so the read becomes more confident.";
  const mainPositive = result.draft.basicAnalysis.whatYoureDoingWell[0] ?? "The clip still provided enough signal to produce a useful draft.";

  if (normalized.includes("score") || normalized.includes("how did i do")) {
    return `Your current overall score is ${score === null ? "not available because this clip should be rejected" : `${Math.round(score)}/100`}. The biggest takeaway is: ${topCue}`;
  }

  if (normalized.includes("fix") || normalized.includes("improve") || normalized.includes("wrong")) {
    return `The first thing I would fix is: ${mainFix} After that, focus on ${topCue.toLowerCase()}`;
  }

  if (normalized.includes("good") || normalized.includes("well") || normalized.includes("positive")) {
    return `What looks best right now: ${mainPositive}`;
  }

  if (normalized.includes("tempo") || normalized.includes("fast") || normalized.includes("slow")) {
    return `The tempo read is ${result.draft.scores.tempo === null ? "not available" : `${Math.round(result.draft.scores.tempo)}/100`}. ${result.payload.repStats.averageRepDurationMs === null ? "I do not have clean rep timing yet, so this is still a rough read." : `Your average provisional rep duration is about ${Math.round(result.payload.repStats.averageRepDurationMs)}ms.`}`;
  }

  if (normalized.includes("symmetry") || normalized.includes("balanced") || normalized.includes("left") || normalized.includes("right")) {
    return `The symmetry read is ${result.draft.scores.symmetry === null ? "not available" : `${Math.round(result.draft.scores.symmetry)}/100`}. ${result.draft.risks[0] ?? "I do not see a major asymmetry risk flagged in this draft."}`;
  }

  if (normalized.includes("risk") || normalized.includes("danger") || normalized.includes("pain")) {
    return result.draft.risks[0] ?? "No major risk was flagged in this draft, but a cleaner clip would make that conclusion more trustworthy.";
  }

  if (normalized.includes("next") || normalized.includes("what should i do next")) {
    return result.nextStep;
  }

  return `Based on this analysis, I would focus on ${topCue.toLowerCase()} The clearest strength was: ${mainPositive}`;
}

export function createLocalChatReply({
  analysisResult,
  prompt,
}: {
  analysisResult: AnalysisRunResult;
  prompt: string;
}): ChatReply {
  const content = buildResponse(analysisResult, prompt);
  const message: ChatMessage = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: "assistant",
    content,
    createdAt: Date.now(),
    provider: "local",
  };

  return {
    message,
    provider: "local",
    error: null,
  };
}
