import type { AnalysisRunResult } from "@/lib/analysis-contract";
import { cn } from "@/lib/utils";
import { SparklesIcon, CheckCircleIcon, ExclamationTriangleIcon, LightBulbIcon, ShieldExclamationIcon } from "@heroicons/react/24/outline";

function formatScore(value: number | null) {
  return value === null ? "--" : String(Math.round(value));
}

function getProviderLabel(provider: AnalysisRunResult["provider"]) {
  if (provider === "gemini") return "Gemini";
  if (provider === "heuristic") return "Heuristic";
  return "Draft";
}

function getProviderStyle(provider: AnalysisRunResult["provider"]) {
  if (provider === "gemini") return "bg-emerald-100 text-emerald-700";
  if (provider === "heuristic") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

function getScoreColor(value: number | null) {
  if (value === null) return "text-[var(--ink-muted)]";
  if (value >= 85) return "text-emerald-600";
  if (value >= 65) return "text-[var(--accent)]";
  return "text-amber-600";
}

function getPriorityStyle(priority: "high" | "medium" | "low") {
  if (priority === "high") return "bg-red-100 text-red-700";
  if (priority === "medium") return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
}

type AnalysisResultsPanelProps = {
  result: AnalysisRunResult;
  isPreview: boolean;
};

export function AnalysisResultsPanel({ result, isPreview }: AnalysisResultsPanelProps) {
  return (
    <div className="space-y-5">
      {/* ─── Score hero ─── */}
      <div className="rounded-[28px] bg-gradient-to-br from-[#0f172a] to-[#1e293b] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <span className={cn("inline-flex rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wider", getProviderStyle(result.provider))}>
              {isPreview ? "Local preview" : getProviderLabel(result.provider)}
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-white/40">Overall score</p>
              <p className="mt-2 text-5xl font-light tabular-nums text-white">{formatScore(result.draft.scores.overall)}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              ["Mode", result.mode],
              ["Confidence", result.confidence],
              ["Provider", result.provider],
              ["Reps", String(result.payload.repStats.detectedRepCount)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white/[0.08] px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-white/40">{label}</p>
                <p className="mt-0.5 text-sm font-medium text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-white/70">{result.summary}</p>
      </div>

      {/* ─── Sub-scores ─── */}
      <div className="grid gap-3 sm:grid-cols-5">
        {[
          ["ROM", result.draft.scores.rom],
          ["Tension", result.draft.scores.tensionProfile],
          ["Tempo", result.draft.scores.tempo],
          ["Symmetry", result.draft.scores.symmetry],
          ["Fatigue", result.draft.scores.fatigueManagement],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">{label}</p>
            <p className={cn("mt-2 text-2xl font-medium", getScoreColor(value as number | null))}>
              {formatScore(value as number | null)}
            </p>
          </div>
        ))}
      </div>

      {/* ─── Doing well / To fix ─── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5">
          <div className="flex items-center gap-2">
            <CheckCircleIcon className="h-5 w-5 text-emerald-600" />
            <h3 className="text-sm font-medium text-emerald-800">Doing well</h3>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-emerald-900/70">{result.draft.basicAnalysis.summary}</p>
          <ul className="mt-3 space-y-2">
            {result.draft.basicAnalysis.whatYoureDoingWell.length > 0 ? (
              result.draft.basicAnalysis.whatYoureDoingWell.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-emerald-900">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  {item}
                </li>
              ))
            ) : (
              <li className="text-sm text-emerald-700/50">No strong positives detected yet.</li>
            )}
          </ul>
        </div>

        <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-5">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />
            <h3 className="text-sm font-medium text-amber-800">What to fix</h3>
          </div>
          <ul className="mt-3 space-y-2">
            {result.draft.basicAnalysis.whatToFix.length > 0 ? (
              result.draft.basicAnalysis.whatToFix.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm leading-relaxed text-amber-900">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                  {item}
                </li>
              ))
            ) : (
              <li className="text-sm text-amber-700/50">No major fixes called out yet.</li>
            )}
          </ul>
        </div>
      </div>

      {/* ─── Coaching cues ─── */}
      <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
        <div className="flex items-center gap-2">
          <LightBulbIcon className="h-5 w-5 text-[var(--accent)]" />
          <h3 className="text-sm font-medium text-[var(--ink)]">Coaching cues</h3>
        </div>
        <div className="mt-4 space-y-2">
          {result.draft.cues.length > 0 ? (
            result.draft.cues.map((cue) => (
              <div key={cue.cue} className="flex items-center justify-between gap-4 rounded-xl bg-[var(--surface-2)] px-4 py-3">
                <p className="text-sm text-[var(--ink)]">{cue.cue}</p>
                <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", getPriorityStyle(cue.priority))}>
                  {cue.priority}
                </span>
              </div>
            ))
          ) : (
            <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink-muted)]">No cues generated yet.</div>
          )}
        </div>
      </div>

      {/* ─── Risks + Next step ─── */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <div className="flex items-center gap-2">
            <ShieldExclamationIcon className="h-5 w-5 text-red-500" />
            <h3 className="text-sm font-medium text-[var(--ink)]">Risks</h3>
          </div>
          <ul className="mt-3 space-y-2">
            {result.draft.risks.length > 0 ? (
              result.draft.risks.map((risk) => (
                <li key={risk} className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--ink-secondary)]">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  {risk}
                </li>
              ))
            ) : (
              <li className="text-sm text-[var(--ink-muted)]">No standout risks flagged.</li>
            )}
          </ul>
        </div>

        <div className="rounded-2xl bg-[var(--accent-light)] p-5">
          <h3 className="text-sm font-medium text-[var(--accent)]">Next step</h3>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink)]">{result.nextStep}</p>
          {result.geminiError ? (
            <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              Gemini fallback: {result.geminiError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
