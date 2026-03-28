import { useState } from "react";
import { ArrowUpIcon, SparklesIcon } from "@heroicons/react/24/solid";
import type { AnalysisRunResult } from "@/lib/analysis-contract";
import type { ChatMessage } from "@/lib/chat-contract";
import { cn } from "@/lib/utils";

function providerLabel(provider?: ChatMessage["provider"]) {
  if (provider === "gemini") return "Gemini";
  if (provider === "heuristic") return "Heuristic";
  return "Draft";
}

function providerStyle(provider?: ChatMessage["provider"]) {
  if (provider === "gemini") return "text-emerald-600";
  if (provider === "heuristic") return "text-amber-600";
  return "text-blue-600";
}

const SUGGESTIONS = [
  "What should I fix first?",
  "Why was my score low?",
  "Was my tempo rushed?",
  "What cue for next set?",
];

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

  function handleSubmit(text: string) {
    const prompt = text.trim();
    if (!prompt) return;
    void onSend(prompt).then(() => setDraft(""));
  }

  return (
    <div className="space-y-4">
      {/* ─── Context hint ─── */}
      <div className="rounded-2xl bg-[var(--surface-tint)] px-5 py-4 ring-1 ring-[var(--outline)]">
        <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">
          {analysisResult
            ? "Ask follow-up questions about your latest analysis. The coach answers from your actual result context."
            : "Run an analysis first, then chat with the coaching assistant about your results."}
        </p>
      </div>

      {/* ─── Suggestion chips ─── */}
      {analysisResult && messages.length <= 1 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => { setDraft(s); handleSubmit(s); }}
              className="rounded-full border border-[var(--outline)] bg-white px-3.5 py-2 text-xs font-medium text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* ─── Messages ─── */}
      <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-2xl bg-[var(--surface-2)] p-4">
        {messages.length > 0 ? (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "rounded-2xl px-4 py-3.5",
                message.role === "user"
                  ? "ml-8 bg-[var(--accent)] text-white"
                  : "mr-8 bg-white text-[var(--ink)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <p className={cn(
                  "text-[10px] font-semibold uppercase tracking-wider",
                  message.role === "user" ? "text-white/60" : "text-[var(--ink-muted)]",
                )}>
                  {message.role === "user" ? "You" : "Coach"}
                </p>
                {message.role === "assistant" && message.provider ? (
                  <span className={cn("text-[10px] font-semibold uppercase tracking-wider", providerStyle(message.provider))}>
                    {providerLabel(message.provider)}
                  </span>
                ) : null}
              </div>
              <p className={cn(
                "mt-1.5 text-sm leading-relaxed",
                message.role === "user" ? "text-white/90" : "text-[var(--ink-secondary)]",
              )}>
                {message.content}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-2xl bg-white px-4 py-3.5 text-sm text-[var(--ink-muted)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--outline)]">
            No messages yet.
          </div>
        )}
      </div>

      {/* ─── Error ─── */}
      {chatError ? (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {chatError}
        </div>
      ) : null}

      {/* ─── Input ─── */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSubmit(draft); }}
        className="flex items-center gap-3 rounded-2xl bg-[var(--surface-2)] px-4 py-3"
      >
        <SparklesIcon className="h-5 w-5 shrink-0 text-[var(--accent)]" />
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask about your analysis..."
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)]"
        />
        <button
          type="submit"
          disabled={disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white transition hover:bg-[var(--accent-hover)] disabled:opacity-30"
        >
          <ArrowUpIcon className="h-4 w-4" />
        </button>
      </form>
      <p className="text-xs text-[var(--ink-muted)]">
        {chatState === "running" ? "Generating reply..." : analysisResult ? `Using ${analysisResult.provider} analysis context.` : "Waiting for analysis result."}
      </p>
    </div>
  );
}
