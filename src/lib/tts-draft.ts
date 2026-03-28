import type { AnalysisRunResult } from "./analysis-contract";
import type { TtsResponse } from "./tts-contract";

export function createLocalTtsResponse(analysisResult: AnalysisRunResult): TtsResponse {
  const score = analysisResult.draft.scores.overall;
  const topCue = analysisResult.draft.cues[0]?.cue ?? analysisResult.nextStep;
  const mainFix = analysisResult.draft.basicAnalysis.whatToFix[0] ?? "Get a cleaner full-body view for a more confident read.";
  const intro =
    score === null
      ? "I could not score this clip confidently."
      : `Your current form score is ${Math.round(score)} out of 100.`;

  return {
    script: `${intro} Main focus: ${topCue} Biggest fix: ${mainFix}`,
    provider: "local",
    audioUrl: null,
    mimeType: null,
    voiceName: null,
    cached: false,
    error: null,
  };
}
