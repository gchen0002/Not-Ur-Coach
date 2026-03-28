import { getSimilarityPercent, summarizeAnalysisProgress } from "@/lib/analysis-history";
import type { AnalysisHistoryEntry } from "@/lib/analysis-contract";
import { cn } from "@/lib/utils";
import { ClockIcon } from "@heroicons/react/24/outline";

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
  if (current === null || comparison === null) return "--";
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

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl bg-[var(--surface-tint)] px-8 py-12 ring-1 ring-[var(--outline)]">
        <ClockIcon className="h-8 w-8 text-[var(--ink-muted)]" />
        <p className="mt-3 text-sm text-[var(--ink-muted)]">Run analysis to build progress history.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ─── Quick metrics ─── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Latest", latest?.overallScore == null ? "--" : String(Math.round(latest.overallScore))],
          ["Average", progress.averageScore == null ? "--" : String(Math.round(progress.averageScore))],
          ["Delta", progress.scoreDelta == null ? "--" : `${progress.scoreDelta > 0 ? "+" : ""}${progress.scoreDelta}`],
          ["Best", best?.overallScore == null ? "--" : String(Math.round(best.overallScore))],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-4 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--ink-muted)]">{label}</p>
            <p className={cn(
              "mt-1.5 text-2xl font-medium",
              typeof value === "string" && value.startsWith("+") ? "text-emerald-600" : typeof value === "string" && value.startsWith("-") ? "text-red-500" : "text-[var(--accent)]",
            )}>
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* ─── Score trend chart ─── */}
      <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium text-[var(--ink)]">Score trend</h3>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">Recent runs, oldest to newest</p>
          </div>
          <div className="rounded-xl bg-[var(--surface-2)] px-3 py-2 text-center">
            <p className="text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">Runs</p>
            <p className="text-lg font-medium text-[var(--accent)]">{history.length}</p>
          </div>
        </div>
        <div className="mt-4 rounded-xl bg-[var(--surface-2)] p-4">
          {points ? (
            <svg viewBox="0 0 320 150" className="h-40 w-full">
              {[30, 60, 90, 120].map((y) => (
                <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              ))}
              <polyline
                fill="none"
                stroke="#4f46e5"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={points}
              />
              {points.split(" ").map((point, index) => {
                const [x, y] = point.split(",");
                const entry = plottedEntries[index];
                return (
                  <g key={`${entry.id}-${point}`}>
                    <circle cx={x} cy={y} r="4" fill="#4f46e5" />
                    <text x={x} y={Number(y) - 10} textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="Google Sans, sans-serif">
                      {entry.overallScore === null ? "--" : Math.round(entry.overallScore)}
                    </text>
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-[var(--ink-muted)]">
              More analyses needed to plot a trend.
            </div>
          )}
        </div>
      </div>

      {/* ─── Nearest match ─── */}
      {progress.bestMatch && (
        <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
          <h3 className="text-sm font-medium text-[var(--ink)]">Nearest prior match</h3>
          <div className="mt-3 space-y-2">
            <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <p className="text-sm font-medium text-[var(--accent)]">{progress.bestMatchPercent}% similar</p>
              <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                {progress.bestMatch.clipName ?? "camera session"} · {progress.bestMatch.cameraAngle} · {formatTimestamp(progress.bestMatch.createdAt)}
              </p>
            </div>
            <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">{progress.bestMatch.summary}</p>
          </div>
        </div>
      )}

      {/* ─── Movement comparison ─── */}
      <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
        <h3 className="text-sm font-medium text-[var(--ink)]">Movement comparison</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            { label: "Score vs prev", current: latest?.overallScore ?? null, comparison: previous?.overallScore ?? null, suffix: "" },
            { label: "Rep duration vs prev", current: latest?.averageRepDurationMs ?? null, comparison: previous?.averageRepDurationMs ?? null, suffix: "ms" },
            { label: "Bottom knee vs prev", current: latest?.averageBottomKneeAngle ?? null, comparison: previous?.averageBottomKneeAngle ?? null, suffix: "deg" },
            { label: "Rep count vs prev", current: latest?.repCount ?? null, comparison: previous?.repCount ?? null, suffix: "" },
          ].map((metric) => (
            <div key={metric.label} className="rounded-xl bg-[var(--surface-2)] px-4 py-3.5">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--ink-muted)]">{metric.label}</p>
              <p className="mt-1.5 text-xl font-medium text-[var(--accent)]">
                {renderChange(metric.current, metric.comparison, metric.suffix)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                now {formatMetric(metric.current, metric.suffix)} / prev {formatMetric(metric.comparison, metric.suffix)}
              </p>
            </div>
          ))}
        </div>
        {best ? (
          <p className="mt-4 text-xs leading-relaxed text-[var(--ink-muted)]">
            Best run: {formatMetric(best.overallScore)} overall, {formatMetric(best.averageBottomKneeAngle, "deg")} avg bottom knee, {formatMetric(best.averageRepDurationMs, "ms")} avg rep.
          </p>
        ) : null}
      </div>

      {/* ─── Recent runs ─── */}
      <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
        <h3 className="text-sm font-medium text-[var(--ink)]">Recent runs</h3>
        <div className="mt-3 space-y-2">
          {history.slice(0, 5).map((entry, index) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] px-4 py-3.5">
              <div>
                <p className="text-sm font-medium text-[var(--ink)]">
                  {entry.clipName ?? `Run ${history.length - index}`}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
                  {entry.provider} · {entry.mode} · {entry.cameraAngle} · {formatTimestamp(entry.createdAt)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xl font-medium text-[var(--accent)]">
                  {entry.overallScore === null ? "--" : Math.round(entry.overallScore)}
                </p>
                {index > 0 && latest ? (
                  <p className="text-[10px] text-[var(--ink-muted)]">{getSimilarityPercent(latest, entry)}% similar</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
