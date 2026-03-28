import { SurfaceCard } from "@/components/ui/surface-card";
import type { TtsResponse } from "@/lib/tts-contract";

type TtsPanelProps = {
  canSpeak: boolean;
  ttsState: "idle" | "loading" | "speaking" | "error";
  ttsError: string | null;
  lastResponse: TtsResponse | null;
  onSpeak: () => Promise<void>;
  onStop: () => void;
};

export function TtsPanel({
  canSpeak,
  ttsState,
  ttsError,
  lastResponse,
  onSpeak,
  onStop,
}: TtsPanelProps) {
  return (
    <SurfaceCard
      eyebrow="Block 10"
      title="Spoken feedback"
      description="This starter TTS flow turns the latest analysis into a short spoken coaching script. Browser speech handles playback, while Convex/Gemini can improve the script when configured."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              void onSpeak();
            }}
            disabled={!canSpeak || ttsState === "loading" || ttsState === "speaking"}
            className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {ttsState === "loading" ? "Preparing voice..." : ttsState === "speaking" ? "Speaking" : "Play feedback"}
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={ttsState !== "speaking"}
            className="rounded-full border border-[var(--outline)] bg-white px-5 py-3 text-sm font-semibold text-[var(--ink)] shadow-[var(--shadow-1)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Stop audio
          </button>
        </div>

        {ttsError ? (
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {ttsError}
          </div>
        ) : null}

        <div className="rounded-xl bg-[var(--surface-2)] px-4 py-4 text-sm text-[var(--ink-secondary)]">
          <p className="font-medium text-[var(--ink)]">Voice script</p>
          <p className="mt-2 leading-7">
            {lastResponse?.script ?? "Run analysis first, then play spoken feedback from the latest result."}
          </p>
          {lastResponse ? (
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              provider: {lastResponse.provider}{lastResponse.error ? ` | fallback: ${lastResponse.error}` : ""}
            </p>
          ) : null}
        </div>
      </div>
    </SurfaceCard>
  );
}
