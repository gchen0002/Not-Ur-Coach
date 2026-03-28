import type { AnalysisHistoryEntry, AnalysisRunResult } from "@/lib/analysis-contract";

const ANALYSIS_HISTORY_KEY = "not-ur-coach.analysis-history";
const MAX_HISTORY_ENTRIES = 8;

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10) / 10;
}

export function toAnalysisHistoryEntry(result: AnalysisRunResult): AnalysisHistoryEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    provider: result.provider,
    sourceType: result.payload.sourceType,
    clipName: result.payload.clipName,
    mode: result.mode,
    confidence: result.confidence,
    overallScore: result.draft.scores.overall,
    repCount: result.payload.repStats.detectedRepCount,
    averageRepDurationMs: result.payload.repStats.averageRepDurationMs,
    averageBottomKneeAngle: result.payload.repStats.averageBottomKneeAngle,
    averageBottomPrimaryMetricValue: result.payload.repStats.averageBottomPrimaryMetricValue,
    cameraAngle: result.payload.cameraAngle.label,
    summary: result.summary,
    cues: result.draft.cues.map((cue) => cue.cue),
  };
}

export function loadAnalysisHistory(): AnalysisHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(ANALYSIS_HISTORY_KEY);

    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendAnalysisHistory(result: AnalysisRunResult): AnalysisHistoryEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  const nextEntries = [toAnalysisHistoryEntry(result), ...loadAnalysisHistory()].slice(0, MAX_HISTORY_ENTRIES);
  window.localStorage.setItem(ANALYSIS_HISTORY_KEY, JSON.stringify(nextEntries));
  return nextEntries;
}

export function getSimilarityPercent(current: AnalysisHistoryEntry, candidate: AnalysisHistoryEntry) {
  let score = 100;

  if (current.overallScore !== null && candidate.overallScore !== null) {
    score -= Math.min(40, Math.abs(current.overallScore - candidate.overallScore) * 1.4);
  }

  if (current.averageBottomKneeAngle !== null && candidate.averageBottomKneeAngle !== null) {
    score -= Math.min(25, Math.abs(current.averageBottomKneeAngle - candidate.averageBottomKneeAngle) * 0.9);
  }

  if (current.averageRepDurationMs !== null && candidate.averageRepDurationMs !== null) {
    score -= Math.min(20, Math.abs(current.averageRepDurationMs - candidate.averageRepDurationMs) / 90);
  }

  if (current.cameraAngle !== candidate.cameraAngle) {
    score -= 10;
  }

  if (current.mode !== candidate.mode) {
    score -= 8;
  }

  return Math.max(0, Math.round(score));
}

export function summarizeAnalysisProgress(history: AnalysisHistoryEntry[]) {
  if (history.length === 0) {
    return {
      latest: null,
      previous: null,
      best: null,
      scoreDelta: null as number | null,
      bestMatch: null as AnalysisHistoryEntry | null,
      bestMatchPercent: null as number | null,
      averageScore: null as number | null,
    };
  }

  const latest = history[0];
  const previous = history[1] ?? null;
  const scoredEntries = history.filter((entry) => entry.overallScore !== null);
  const averageScore =
    scoredEntries.length > 0
      ? round(scoredEntries.reduce((sum, entry) => sum + (entry.overallScore ?? 0), 0) / scoredEntries.length)
      : null;
  const best = scoredEntries.reduce<AnalysisHistoryEntry | null>((currentBest, entry) => {
    if (!currentBest) {
      return entry;
    }

    return (entry.overallScore ?? -1) > (currentBest.overallScore ?? -1) ? entry : currentBest;
  }, null);

  const candidates = history.slice(1);
  let bestMatch: AnalysisHistoryEntry | null = null;
  let bestMatchPercent: number | null = null;

  for (const candidate of candidates) {
    const similarity = getSimilarityPercent(latest, candidate);
    if (bestMatchPercent === null || similarity > bestMatchPercent) {
      bestMatch = candidate;
      bestMatchPercent = similarity;
    }
  }

  return {
    latest,
    previous,
    best,
    scoreDelta:
      latest.overallScore !== null && previous?.overallScore !== null
        ? round(latest.overallScore - previous.overallScore)
        : null,
    bestMatch,
    bestMatchPercent,
    averageScore,
  };
}
