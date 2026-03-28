import { SurfaceCard } from "@/components/ui/surface-card";
import type { LiveCoachContextResult } from "@/lib/live-session-contract";

type LiveCoachPanelProps = {
  canPrepare: boolean;
  prepState: "idle" | "loading" | "ready" | "error";
  prepError: string | null;
  context: LiveCoachContextResult | null;
  connectionState: "idle" | "connecting" | "connected" | "error";
  connectionError: string | null;
  transcript: Array<{ role: "assistant" | "system"; content: string }>;
  onPrepare: () => Promise<void>;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  onSendSnapshot: () => Promise<void>;
};

export function LiveCoachPanel({
  canPrepare,
  prepState,
  prepError,
  context,
  connectionState,
  connectionError,
  transcript,
  onPrepare,
  onConnect,
  onDisconnect,
  onSendSnapshot,
}: LiveCoachPanelProps) {
  const connected = connectionState === "connected";

  return (
    <SurfaceCard
      eyebrow="Block 10"
      title="Gemini Live coach"
      description="Infer the exercise first, hydrate DB-backed coaching guardrails, then open a tight Gemini Live session that works from snapshots and tiny delta packets."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void onPrepare();
            }}
            disabled={!canPrepare || prepState === "loading"}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {prepState === "loading" ? "Inferring exercise..." : "Prepare live coach"}
          </button>

          {connected ? (
            <button
              type="button"
              onClick={onDisconnect}
              className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)]"
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                void onConnect();
              }}
              disabled={!context || connectionState === "connecting"}
              className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connectionState === "connecting" ? "Connecting..." : "Start live session"}
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              void onSendSnapshot();
            }}
            disabled={!connected}
            className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Send live snapshot
          </button>
        </div>

        {prepError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {prepError}
          </div>
        ) : null}

        {connectionError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {connectionError}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="space-y-3 rounded-2xl bg-[var(--surface-2)] p-4">
            <p className="text-sm font-medium text-[var(--ink)]">Prepared context</p>
            {context ? (
              <>
                <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Exercise</p>
                  <p className="mt-1 text-sm font-medium text-[var(--ink)]">{context.inferredExercise ?? "Unknown"}</p>
                  <p className="mt-2 text-xs text-[var(--ink-muted)]">confidence: {context.confidence}</p>
                </div>
                <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Target muscles</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {context.targetMuscles.length > 0 ? context.targetMuscles.map((item) => (
                      <span key={item} className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--ink-secondary)]">
                        {item}
                      </span>
                    )) : (
                      <span className="text-sm text-[var(--ink-muted)]">No target muscles resolved yet.</span>
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-white px-4 py-3 shadow-sm">
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">Guardrails</p>
                  <ul className="mt-2 space-y-2">
                    {context.guardrails.map((item) => (
                      <li key={item} className="text-sm leading-6 text-[var(--ink-secondary)]">{item}</li>
                    ))}
                  </ul>
                </div>
              </>
            ) : (
              <div className="rounded-xl bg-white px-4 py-3 text-sm text-[var(--ink-muted)] shadow-sm">
                Prepare the live coach first so Gemini can infer the exercise and load DB-backed guidance.
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-2xl bg-[var(--surface-2)] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-[var(--ink)]">Live transcript</p>
              <span className="text-xs uppercase tracking-[0.16em] text-[var(--ink-muted)]">{connectionState}</span>
            </div>
            <div className="max-h-72 space-y-3 overflow-y-auto rounded-xl bg-white p-4 shadow-sm">
              {transcript.length > 0 ? transcript.map((item, index) => (
                <div key={`${item.role}-${index}`} className="rounded-xl bg-[var(--surface-2)] px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-muted)]">{item.role}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{item.content}</p>
                </div>
              )) : (
                <div className="text-sm text-[var(--ink-muted)]">
                  No live messages yet. Start the session and send a snapshot.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}
