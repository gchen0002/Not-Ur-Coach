import { GoogleGenAI } from "@google/genai";
import { actionGeneric } from "convex/server";

type VideoModelListItem = {
  name: string;
  displayName?: string;
  description?: string;
  supportedActions?: string[];
};

type ModelListResponse = {
  page?: VideoModelListItem[];
  models?: VideoModelListItem[];
};

export const listVideoModels = actionGeneric({
  args: {},
  handler: async () => {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return [];
    }

    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    const response = await ai.models.list({}) as ModelListResponse;
    const models = response.page ?? response.models ?? [];

    return models
      .filter((model) => Array.isArray(model.supportedActions) && model.supportedActions.includes("generateVideos"))
      .map((model) => ({
        name: model.name,
        displayName: model.displayName ?? null,
        description: model.description ?? null,
        supportedActions: model.supportedActions ?? [],
      }));
  },
});
