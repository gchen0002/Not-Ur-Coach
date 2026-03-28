import { SurfaceCard } from "@/components/ui/surface-card";
import { getSimilarityPercent, summarizeAnalysisProgress } from "@/lib/analysis-history";
import type { AnalysisHistoryEntry } from "@/lib/analysis-contract";

function formatTimestamp(value: number) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatMetric(value: number | null, suffix = "") {
  return value === null ? "--" : `${Math.round(value)}${suffix}`;
}

function buildScorePath(history: AnalysisHistoryEntry[]) {
  const scoredEntries = [...history]
    .reverse()
    .filter((entry) => entry.overallScore !== null);

  if (scoredEntries.length === 0) {
    return { points: "", plottedEntries: [] as AnalysisHistoryEntry[] };
  }

  const width = 320;
  const height = 150;
  const minScore = Math.min(...scoredEntries.map((entry) => entry.overallScore ?? 0));
  const maxScore = Math.max(...scoredEntries.map((entry) => entry.overallScore ?? 0));
  const scoreRange = Math.max(8, maxScore - minScore);

  const points = scoredEntries.map((entry, index) => {
    const x = scoredEntries.length === 1 ? width / 2 : (index / (scoredEntries.length - 1)) * width;
    const normalized = ((entry.overallScore ?? minScore) - minScore) / scoreRange;
    const y = height - (normalized * (height - 24)) - 12;
    return `${x},${y}`;
  }).join(" ");

  return { points, plottedEntries: scoredEntries };
}

function renderChange(current: number | null, comparison: number | null, suffix = "") {
  if (current === null || comparison === null) {
    return "--";
  }

  const delta = Math.round((current - comparison) * 10) / 10;
  return `${delta > 0 ? "+" : ""}${delta}${suffix}`;
}

type ProgressHistoryPanelProps = {
  history: AnalysisHistoryEntry[];
};

export function ProgressHistoryPanel({ history }: ProgressHistoryPanelProps) {
  const progress = summarizeAnalysisProgress(history);
  const { points, plottedEntries } = buildScorePath(history);
  const latest = progress.latest;
  const previous = progress.previous;
  const best = progress.best;

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
              ["Latest score", latest?.overallScore === null || latest?.overallScore === undefined ? "--" : String(Math.round(latest.overallScore))],
              ["Average score", progress.averageScore === null ? "--" : String(Math.round(progress.averageScore))],
              ["Delta vs prev", progress.scoreDelta === null ? "--" : `${progress.scoreDelta > 0 ? "+" : ""}${progress.scoreDelta}`],
              ["Best score", best?.overallScore === null || best?.overallScore === undefined ? "--" : String(Math.round(best.overallScore))],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[24px] bg-[var(--surface-2)] px-4 py-4">
                <p className="text-sm font-medium text-[var(--ink)]">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-[var(--accent-strong)]">{value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Score trend</p>
                  <p className="mt-2 text-sm leading-7 text-[var(--ink-soft)]">Recent local runs plotted oldest to newest so you can see whether the demo feedback is trending in the right direction.</p>
                </div>
                <div className="rounded-[18px] bg-white px-4 py-3 text-right shadow-[var(--shadow-1)]">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">Runs tracked</p>
                  <p className="mt-1 text-2xl font-semibold text-[var(--accent-strong)]">{history.length}</p>
                </div>
              </div>
              <div className="mt-5 rounded-[24px] bg-white p-4 shadow-[var(--shadow-1)]">
                {points ? (
                  <svg viewBox="0 0 320 150" className="h-44 w-full">
                    <defs>
                      <linearGradient id="score-line" x1="0" x2="1" y1="0" y2="0">
                        <stop offset="0%" stopColor="#1f4b6e" />
                        <stop offset="100%" stopColor="#4f8f86" />
                      </linearGradient>
                    </defs>
                    {[20, 55, 90, 125].map((y) => (
                      <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="#e7edf6" strokeWidth="1" />
                    ))}
                    <polyline
                      fill="none"
                      stroke="url(#score-line)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={points}
                    />
                    {points.split(" ").map((point, index) => {
                      const [x, y] = point.split(",");
                      const entry = plottedEntries[index];
                      return (
                        <g key={`${entry.id}-${point}`}>
                          <circle cx={x} cy={y} r="5" fill="#1f4b6e" />
                          <text x={x} y={Number(y) - 12} textAnchor="middle" fontSize="10" fill="#43617f">
                            {entry.overallScore === null ? "--" : Math.round(entry.overallScore)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                ) : (
                  <div className="flex h-44 items-center justify-center text-sm text-[var(--ink-soft)]">
                    Run a couple more analyses to plot a score trend.
                  </div>
                )}
              </div>
            </div>

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
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--accent-strong)]">Movement comparison</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  {
                    label: "Score vs previous",
                    current: latest?.overallScore ?? null,
                    comparison: previous?.overallScore ?? null,
                    suffix: "",
                  },
                  {
                    label: "Rep duration vs previous",
                    current: latest?.averageRepDurationMs ?? null,
                    comparison: previous?.averageRepDurationMs ?? null,
                    suffix: "ms",
                  },
                  {
                    label: "Bottom knee vs previous",
                    current: latest?.averageBottomKneeAngle ?? null,
                    comparison: previous?.averageBottomKneeAngle ?? null,
                    suffix: "deg",
                  },
                  {
                    label: "Rep count vs previous",
                    current: latest?.repCount ?? null,
                    comparison: previous?.repCount ?? null,
                    suffix: "",
                  },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-[18px] bg-white px-4 py-4 shadow-[var(--shadow-1)]">
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--ink-soft)]">{metric.label}</p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--accent-strong)]">
                      {renderChange(metric.current, metric.comparison, metric.suffix)}
                    </p>
                    <p className="mt-2 text-sm text-[var(--ink-soft)]">
                      now {formatMetric(metric.current, metric.suffix)} / prev {formatMetric(metric.comparison, metric.suffix)}
                    </p>
                  </div>
                ))}
              </div>
              {best ? (
                <div className="mt-4 rounded-[18px] bg-white px-4 py-4 shadow-[var(--shadow-1)] text-sm text-[var(--ink-soft)]">
                  Best local run so far: {formatMetric(best.overallScore)} overall, {formatMetric(best.averageBottomKneeAngle, "deg")} average bottom knee, {formatMetric(best.averageRepDurationMs, "ms")} average rep duration.
                </div>
              ) : null}
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
                        {index > 0 && latest ? (
                          <p className="text-xs text-[var(--ink-soft)]">{getSimilarityPercent(latest, entry)}% similar</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--ink-soft)]">
                      <span className="rounded-full bg-[var(--surface-2)] px-3 py-1">reps {entry.repCount}</span>
                      <span className="rounded-full bg-[var(--surface-2)] px-3 py-1">tempo {formatMetric(entry.averageRepDurationMs, "ms")}</span>
                      <span className="rounded-full bg-[var(--surface-2)] px-3 py-1">bottom {formatMetric(entry.averageBottomKneeAngle, "deg")}</span>
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
