import { ChartBarIcon, ClockIcon } from "@heroicons/react/24/outline";

export function HistoryPage() {
  return (
    <div className="space-y-8 pb-12">
      {/* ─── Header ─── */}
      <div>
        <div className="flex items-center gap-2">
          <ChartBarIcon className="h-5 w-5 text-[var(--accent)]" />
          <h1 className="text-2xl font-normal text-[var(--ink)]">History</h1>
        </div>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-[var(--ink-secondary)]">
          Past analyses, progress charts, and nearest-neighbor clip comparisons will land here after the first end-to-end pipeline works.
        </p>
      </div>

      {/* ─── Empty state ─── */}
      <div className="flex flex-col items-center justify-center rounded-[28px] bg-[var(--surface-tint)] px-8 py-16 ring-1 ring-[var(--outline)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-light)]">
          <ClockIcon className="h-7 w-7 text-[var(--accent)]" />
        </div>
        <h3 className="mt-5 text-base font-medium text-[var(--ink)]">No analyses yet</h3>
        <p className="mt-2 max-w-sm text-center text-sm leading-relaxed text-[var(--ink-secondary)]">
          Run your first analysis from the Analyze page. History and similarity comparisons will appear here automatically.
        </p>
      </div>
    </div>
  );
}
