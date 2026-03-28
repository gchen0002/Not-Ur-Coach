import { GoogleGenAI } from "@google/genai";
import { actionGeneric } from "convex/server";

export const listVideoModels = actionGeneric({
  args: {},
  handler: async () => {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return [];
    }

    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    const response = await ai.models.list({}) as any;
    const models = response.page ?? response.models ?? [];

    return models
      .filter((model: any) => Array.isArray(model.supportedActions) && model.supportedActions.includes("generateVideos"))
      .map((model: any) => ({
        name: model.name,
        displayName: model.displayName ?? null,
        description: model.description ?? null,
        supportedActions: model.supportedActions ?? [],
      }));
  },
});
