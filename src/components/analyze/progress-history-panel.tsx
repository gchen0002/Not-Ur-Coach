import { SurfaceCard } from "@/components/ui/surface-card";
import { getSimilarityPercent, summarizeAnalysisProgress } from "@/lib/analysis-history";
import type { AnalysisHistoryEntry } from "@/lib/analysis-contract";

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type ProgressHistoryPanelProps = {
  history: AnalysisHistoryEntry[];
};

export function ProgressHistoryPanel({ history }: ProgressHistoryPanelProps) {
  const progress = summarizeAnalysisProgress(history);

  return (
    <SurfaceCard
      eyebrow="Block 7"
      title="Progress and similarity"
      description="This local-only history keeps lightweight analysis summaries so the demo can show trend and nearest-match feedback without storing raw clips."
    >
      {history.length === 0 ? (
        <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5 text-sm leading-7 text-[var(--ink-soft)]">
          Run analysis at least once to build local progress history and similarity comparisons.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Latest score", progress.latest?.overallScore === null || progress.latest?.overallScore === undefined ? "--" : String(Math.round(progress.latest.overallScore))],
              ["Average score", progress.averageScore === null ? "--" : String(Math.round(progress.averageScore))],
              ["Delta vs prev", progress.scoreDelta === null ? "--" : `${progress.scoreDelta > 0 ? "+" : ""}${progress.scoreDelta}`],
              ["Best score", progress.best?.overallScore === null || progress.best?.overallScore === undefined ? "--" : String(Math.round(progress.best.overallScore))],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4">
                <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-[var(--accent-strong)]">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Nearest prior match</p>
              {progress.bestMatch ? (
                <div className="mt-4 space-y-3 text-sm text-[var(--ink)]">
                  <div className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)]">
                    <p className="font-medium">{progress.bestMatchPercent}% similar</p>
                    <p className="mt-1 text-[var(--ink-soft)]">
                      {progress.bestMatch.clipName ?? "camera session"} · {progress.bestMatch.cameraAngle} · {formatTimestamp(progress.bestMatch.createdAt)}
                    </p>
                  </div>
                  <div className="rounded-[18px] bg-white px-4 py-3 shadow-[var(--shadow-1)] text-[var(--ink-soft)]">
                    {progress.bestMatch.summary}
                  </div>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-7 text-[var(--ink-soft)]">No prior runs yet, so similarity will appear after the second analysis.</p>
              )}
            </div>

            <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Recent runs</p>
              <div className="mt-4 space-y-3">
                {history.slice(0, 5).map((entry, index) => (
                  <div key={entry.id} className="rounded-[18px] bg-white px-4 py-4 shadow-[var(--shadow-1)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-[var(--ink)]">
                          {entry.clipName ?? `Run ${history.length - index}`}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                          {entry.provider} · {entry.mode} · {entry.cameraAngle} · {formatTimestamp(entry.createdAt)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-semibold text-[var(--accent-strong)]">
                          {entry.overallScore === null ? "--" : Math.round(entry.overallScore)}
                        </p>
                        {index > 0 && progress.latest ? (
                          <p className="text-xs text-[var(--ink-soft)]">{getSimilarityPercent(progress.latest, entry)}% similar</p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </SurfaceCard>
  );
}
