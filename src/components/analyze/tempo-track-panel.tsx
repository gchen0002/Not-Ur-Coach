import { SurfaceCard } from "@/components/ui/surface-card";
import type { TempoTrackResponse } from "@/lib/tempo-track-contract";

type TempoTrackPanelProps = {
  canGenerate: boolean;
  trackState: "idle" | "loading" | "ready" | "error";
  trackError: string | null;
  response: TempoTrackResponse | null;
  onGenerate: () => Promise<void>;
};

export function TempoTrackPanel({
  canGenerate,
  trackState,
  trackError,
  response,
  onGenerate,
}: TempoTrackPanelProps) {
  return (
    <SurfaceCard
      eyebrow="Block 10"
      title="Tempo track"
      description="Generate a tempo-matched training loop from the latest rep timing so the next set has an audible cadence target."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void onGenerate();
            }}
            disabled={!canGenerate || trackState === "loading"}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {trackState === "loading" ? "Generating track..." : "Generate tempo track"}
          </button>
          {response ? (
            <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              {response.tempoPattern} | {response.bpm} BPM | {response.provider}{response.cached ? " cached" : ""}
            </p>
          ) : null}
        </div>

        {trackError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {trackError}
          </div>
        ) : null}

        <div className="rounded-xl bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-secondary)]">
          <p className="font-medium text-[var(--ink)]">Track brief</p>
          <p className="mt-2 leading-7">
            {response?.prompt ?? "Run analysis first, then generate a Lyria-backed tempo loop or a fallback tempo brief."}
          </p>
          {response?.audioUrl ? (
            <audio className="mt-4 w-full" controls src={response.audioUrl} />
          ) : null}
        </div>
      </div>
    </SurfaceCard>
  );
}
