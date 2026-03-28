import type { AnalysisRunResult } from "./analysis-contract";
import type { TempoTrackResponse } from "./tempo-track-contract";

function getTargetPattern(result: AnalysisRunResult) {
  if (result.draft.scores.tempo !== null && result.draft.scores.tempo >= 85) {
    return "2-1-2";
  }

  return "3-1-2";
}

function getRecommendedBpm(pattern: string) {
  const totalSeconds = pattern
    .split("-")
    .map((part) => Number(part) || 1)
    .reduce((sum, value) => sum + value, 0);

  return Math.max(60, Math.min(96, Math.round((60 / totalSeconds) * 6)));
}

export function createTempoTrackDraft(result: AnalysisRunResult): TempoTrackResponse {
  const tempoPattern = getTargetPattern(result);
  const bpm = getRecommendedBpm(tempoPattern);
  const style = result.draft.scores.tempo !== null && result.draft.scores.tempo >= 85
    ? "focused athletic groove"
    : "clear counted training pulse";

  return {
    provider: "heuristic",
    status: "fallback",
    bpm,
    tempoPattern,
    style,
    prompt: `Generate a workout tempo track at ${bpm} BPM with clear markers for a ${tempoPattern} cadence and a focused gym feel.`,
    audioUrl: null,
    mimeType: null,
    cached: false,
    error: null,
  };
}
