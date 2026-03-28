import { useState } from "react";
import { SurfaceCard } from "@/components/ui/surface-card";
import type { AnalysisRunResult } from "@/lib/analysis-contract";
import type { ChatMessage } from "@/lib/chat-contract";

function providerTone(provider?: ChatMessage["provider"]) {
  if (provider === "gemini") {
    return "text-[#17663d]";
  }

  if (provider === "heuristic") {
    return "text-[#9a5a00]";
  }

  return "text-[#2947a8]";
}

type ChatPanelProps = {
  analysisResult: AnalysisRunResult | null;
  messages: ChatMessage[];
  chatState: "idle" | "running" | "error";
  chatError: string | null;
  onSend: (prompt: string) => Promise<void>;
};

export function ChatPanel({
  analysisResult,
  messages,
  chatState,
  chatError,
  onSend,
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  const disabled = !analysisResult || chatState === "running" || draft.trim().length === 0;

  return (
    <SurfaceCard
      eyebrow="Block 8"
      title="Coaching chat"
      description="Ask follow-up questions about the latest analysis without storing the raw clip. The assistant answers from the current result context."
    >
      <div className="space-y-4">
        <div className="rounded-[24px] bg-[var(--surface-2)] px-5 py-5 text-sm leading-7 text-[var(--ink-soft)]">
          {analysisResult
            ? "Ask things like: what should I fix first, why was my score low, was my tempo rushed, or what cue should I focus on next set?"
            : "Run analysis first, then this chat can answer follow-up questions from that result."}
        </div>

        <div className="max-h-[26rem] space-y-3 overflow-y-auto rounded-[24px] bg-[var(--surface-2)] p-4">
          {messages.length > 0 ? (
            messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-[20px] px-4 py-4 shadow-[var(--shadow-1)] ${message.role === "user" ? "ml-8 bg-[var(--accent-strong)] text-white" : "mr-8 bg-white text-[var(--ink)]"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">
                    {message.role === "user" ? "You" : "Coach"}
                  </p>
                  {message.role === "assistant" && message.provider ? (
                    <span className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${providerTone(message.provider)}`}>
                      {message.provider}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm leading-7">{message.content}</p>
              </div>
            ))
          ) : (
            <div className="rounded-[20px] bg-white px-4 py-4 text-sm text-[var(--ink-soft)] shadow-[var(--shadow-1)]">
              No chat messages yet.
            </div>
          )}
        </div>

        {chatError ? (
          <div className="rounded-[20px] border border-[#f0b8b8] bg-[#fff1f1] px-4 py-3 text-sm text-[#8c1d18]">
            {chatError}
          </div>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const prompt = draft.trim();

            if (!prompt) {
              return;
            }

            void onSend(prompt).then(() => {
              setDraft("");
            });
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={3}
            placeholder="Ask a question about your latest analysis..."
            className="w-full rounded-[24px] border border-[var(--outline)] bg-white px-4 py-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--accent-strong)]"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--ink-soft)]">
              {chatState === "running" ? "Generating reply..." : analysisResult ? `Using ${analysisResult.provider} analysis context.` : "Waiting for analysis result."}
            </p>
            <button
              type="submit"
              disabled={disabled}
              className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-1)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </SurfaceCard>
  );
}
