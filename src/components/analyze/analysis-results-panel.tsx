import type { AnalysisRunResult } from "@/lib/analysis-contract";
import { SurfaceCard } from "@/components/ui/surface-card";

function formatScore(value: number | null) {
  return value === null ? "--" : String(Math.round(value));
}

function getProviderTone(provider: AnalysisRunResult["provider"]) {
  if (provider === "gemini") {
    return "bg-[#e7f7ef] text-[#17663d]";
  }

  if (provider === "heuristic") {
    return "bg-[#fff5e5] text-[#9a5a00]";
  }

  return "bg-[#eef2ff] text-[#2947a8]";
}

function getPriorityTone(priority: "high" | "medium" | "low") {
  if (priority === "high") {
    return "bg-[#fff1f1] text-[#8c1d18]";
  }

  if (priority === "medium") {
    return "bg-[#fff5e5] text-[#9a5a00]";
  }

  return "bg-[#eef2ff] text-[#2947a8]";
}

type AnalysisResultsPanelProps = {
  result: AnalysisRunResult;
  isPreview: boolean;
};

export function AnalysisResultsPanel({ result, isPreview }: AnalysisResultsPanelProps) {
  const analysisProviderTone = getProviderTone(result.provider);

  return (
    <SurfaceCard
      eyebrow="Block 6"
      title="Analysis results"
      description="This is the polished feedback layer for the current clip window. It uses the returned analysis when available and falls back to the local draft when Convex or Gemini is unavailable."
    >
      <div className="space-y-4">
        <div className="rounded-[28px] bg-[linear-gradient(135deg,#10233f_0%,#1f4b6e_55%,#4f8f86_100%)] p-5 text-white shadow-[var(--shadow-2)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-3">
              <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${analysisProviderTone}`}>
                {isPreview ? "local preview" : `${result.provider} result`}
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.18em] text-white/70">Overall score</p>
                <p className="mt-2 text-5xl font-semibold leading-none">{formatScore(result.draft.scores.overall)}</p>
              </div>
            </div>
            <div className="grid gap-3 text-sm text-white/85 sm:grid-cols-2">
              {[
                ["Mode", result.mode],
                ["Confidence", result.confidence],
                ["Provider", result.provider],
                ["Detected reps", String(result.payload.repStats.detectedRepCount)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[20px] bg-white/10 px-4 py-3 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/60">{label}</p>
                  <p className="mt-1 font-medium text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-white/88">{result.summary}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[
            ["ROM", result.draft.scores.rom],
            ["Tension", result.draft.scores.tensionProfile],
            ["Tempo", result.draft.scores.tempo],
            ["Symmetry", result.draft.scores.symmetry],
            ["Fatigue", result.draft.scores.fatigueManagement],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4">
              <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--accent-strong)]">{formatScore(value as number | null)}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Doing well</p>
            <p className="mt-3 text-sm leading-7 text-[var(--ink-soft)]">{result.draft.basicAnalysis.summary}</p>
            <ul className="mt-4 space-y-3 text-sm text-[var(--ink)]">
              {result.draft.basicAnalysis.whatYoureDoingWell.length > 0 ? (
                result.draft.basicAnalysis.whatYoureDoingWell.map((item) => (
                  <li key={item} className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)]">{item}</li>
                ))
              ) : (
                <li className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)] text-[var(--ink-soft)]">No strong positives detected yet.</li>
              )}
            </ul>
          </div>

          <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#8c1d18]">What to fix</p>
            <ul className="mt-4 space-y-3 text-sm text-[var(--ink)]">
              {result.draft.basicAnalysis.whatToFix.length > 0 ? (
                result.draft.basicAnalysis.whatToFix.map((item) => (
                  <li key={item} className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)]">{item}</li>
                ))
              ) : (
                <li className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)] text-[var(--ink-soft)]">No major fixes called out yet.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Coaching cues</p>
            <div className="mt-4 space-y-3">
              {result.draft.cues.length > 0 ? (
                result.draft.cues.map((cue) => (
                  <div key={cue.cue} className="rounded-[18px] bg-white px-4 py-4 shadow-[var(--shadow-1)]">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm leading-7 text-[var(--ink)]">{cue.cue}</p>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getPriorityTone(cue.priority)}`}>
                        {cue.priority}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[18px] bg-white px-4 py-4 shadow-[var(--shadow-1)] text-sm text-[var(--ink-soft)]">No cues generated yet.</div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#8c1d18]">Risks</p>
              <ul className="mt-4 space-y-3 text-sm text-[var(--ink)]">
                {result.draft.risks.length > 0 ? (
                  result.draft.risks.map((risk) => (
                    <li key={risk} className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)]">{risk}</li>
                  ))
                ) : (
                  <li className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)] text-[var(--ink-soft)]">No standout risks flagged in this draft.</li>
                )}
              </ul>
            </div>
            <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Next step</p>
              <p className="mt-4 text-sm leading-7 text-[var(--ink)]">{result.nextStep}</p>
              {result.geminiError ? (
                <p className="mt-4 rounded-[18px] bg-white px-4 py-3 text-sm text-[#8c1d18] shadow-[var(--shadow-1)]">
                  Gemini fallback reason: {result.geminiError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}
