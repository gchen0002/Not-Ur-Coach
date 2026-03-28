import { SurfaceCard } from "@/components/ui/surface-card";
import type { LiveSessionRecord } from "@/lib/live-session-contract";

type LiveSessionPanelProps = {
  canSave: boolean;
  saveState: "idle" | "saving" | "error";
  saveError: string | null;
  sessions: LiveSessionRecord[];
  onSave: () => Promise<void>;
};

export function LiveSessionPanel({
  canSave,
  saveState,
  saveError,
  sessions,
  onSave,
}: LiveSessionPanelProps) {
  return (
    <SurfaceCard
      eyebrow="Block 10"
      title="Live session handoff"
      description="Persist a transcript-style handoff record now, so a browser-side Gemini Live session can save into Convex after coaching ends."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void onSave();
            }}
            disabled={!canSave || saveState === "saving"}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveState === "saving" ? "Saving handoff..." : "Save live-session handoff"}
          </button>
          <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
            recent sessions: {sessions.length}
          </p>
        </div>

        {saveError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {saveError}
          </div>
        ) : null}

        <div className="space-y-3">
          {sessions.length > 0 ? sessions.map((session) => (
            <div key={session.sessionId} className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[var(--ink)]">{session.exercise ?? "General coaching handoff"}</p>
                <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{session.source}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--ink-secondary)]">{session.summary}</p>
            </div>
          )) : (
            <div className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink-muted)]">
              No live-session records saved yet.
            </div>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}
