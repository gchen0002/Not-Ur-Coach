import { GoogleGenAI } from "@google/genai";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import type { AnalysisRunResult } from "../src/lib/analysis-contract";
import type { ChatReply, ChatRequest } from "../src/lib/chat-contract";
import { createLocalChatReply } from "../src/lib/chat-draft";

const analysisResultValidator = v.object({
  accepted: v.boolean(),
  mode: v.union(v.literal("full"), v.literal("best_effort"), v.literal("reject")),
  confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
  summary: v.string(),
  nextStep: v.string(),
  provider: v.union(v.literal("gemini"), v.literal("heuristic"), v.literal("local")),
  geminiError: v.union(v.string(), v.null()),
  draft: v.any(),
  fallbackDraft: v.any(),
  payload: v.any(),
});

const chatMessageValidator = v.object({
  id: v.string(),
  role: v.union(v.literal("user"), v.literal("assistant")),
  content: v.string(),
  createdAt: v.number(),
  provider: v.optional(v.union(v.literal("gemini"), v.literal("heuristic"), v.literal("local"))),
});

function extractText(text: string) {
  return text.trim() || "I could not generate a useful coaching reply from that message.";
}

export const coachChat = actionGeneric({
  args: {
    analysisResult: analysisResultValidator,
    messages: v.array(chatMessageValidator),
    prompt: v.string(),
  },
  handler: async (_ctx, args) => {
    const request = args as ChatRequest;
    const fallback = createLocalChatReply({
      analysisResult: request.analysisResult as AnalysisRunResult,
      prompt: request.prompt,
    });
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return fallback satisfies ChatReply;
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const transcript = request.messages
        .slice(-6)
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n");

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          "You are a concise biomechanics coaching assistant for a demo app.",
          "Answer only from the supplied analysis context. If visibility limits reduce certainty, say so clearly.",
          "Keep the answer to 2-4 short sentences.",
          `Analysis result: ${JSON.stringify(request.analysisResult)}`,
          `Recent chat: ${transcript}`,
          `User question: ${request.prompt}`,
        ].join("\n\n"),
      });

      return {
        message: {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          content: extractText(response.text ?? ""),
          createdAt: Date.now(),
          provider: "gemini",
        },
        provider: "gemini",
        error: null,
      } satisfies ChatReply;
    } catch (error) {
      return {
        ...fallback,
        provider: "heuristic",
        message: {
          ...fallback.message,
          provider: "heuristic",
        },
        error: error instanceof Error ? error.message : "Chat generation failed.",
      } satisfies ChatReply;
    }
  },
});
