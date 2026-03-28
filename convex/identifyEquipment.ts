import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { EquipmentDetectionRequest, EquipmentDetectionResult } from "../src/lib/equipment-detection-contract";
import { createEquipmentDetectionDraft } from "../src/lib/equipment-detection-draft";

const requestValidator = v.object({
  imageDataUrl: v.string(),
  notes: v.optional(v.string()),
});

function extractJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON object.");
  }

  return text.slice(start, end + 1);
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);

  if (!match) {
    throw new Error("Equipment photo must be a base64 data URL.");
  }

  return {
    mimeType: match[1],
    data: match[2],
  };
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function sanitizeResponse(candidate: unknown, catalog: string[], fallback: EquipmentDetectionResult): EquipmentDetectionResult {
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const catalogByName = new Map(catalog.map((name) => [normalizeName(name), name]));
  const result = candidate as Partial<EquipmentDetectionResult> & {
    detectedEquipment?: Array<{ name?: string; matchedCatalogName?: string; confidence?: number }>;
  };

  const detectedEquipment = Array.isArray(result.detectedEquipment)
    ? result.detectedEquipment
      .map((item) => {
        const requestedName = typeof item.name === "string" ? item.name : "";
        const matchedName = typeof item.matchedCatalogName === "string" ? item.matchedCatalogName : requestedName;
        const catalogName = catalogByName.get(normalizeName(matchedName)) ?? catalogByName.get(normalizeName(requestedName));

        if (!catalogName) {
          return null;
        }

        return {
          name: requestedName || catalogName,
          matchedCatalogName: catalogName,
          confidence: typeof item.confidence === "number" ? Math.max(0.1, Math.min(0.99, item.confidence)) : 0.6,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .slice(0, 5)
    : fallback.detectedEquipment;

  return {
    provider: "gemini",
    detectedEquipment,
    summary: typeof result.summary === "string" && result.summary.trim().length > 0
      ? result.summary.trim()
      : fallback.summary,
    error: typeof result.error === "string" ? result.error : null,
  };
}

export const identifyEquipment = actionGeneric({
  args: {
    request: requestValidator,
  },
  handler: async (ctx, args) => {
    const request = args.request as EquipmentDetectionRequest;
    const listCatalogRef = makeFunctionReference<"query", Record<string, never>, string[]>("equipment:listCatalog");
    const catalog = await ctx.runQuery(listCatalogRef, {});
    const fallback = createEquipmentDetectionDraft(request.notes, catalog);
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!apiKey) {
      return fallback;
    }

    try {
      const imagePart = parseDataUrl(request.imageDataUrl);
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{
          role: "user",
          parts: [
            {
              text: [
                "Identify the gym equipment visible in this photo for a fitness coaching app.",
                "Return JSON only with this exact shape:",
                JSON.stringify(fallback),
                `Available equipment catalog: ${JSON.stringify(catalog)}`,
                request.notes ? `User notes: ${request.notes}` : "",
                "Only match to items from the available equipment catalog.",
              ].filter(Boolean).join("\n\n"),
            },
            {
              inlineData: {
                mimeType: imagePart.mimeType,
                data: imagePart.data,
              },
            },
          ],
        }],
      });

      return sanitizeResponse(JSON.parse(extractJsonObject(response.text ?? "")), catalog, fallback);
    } catch (error) {
      return {
        ...fallback,
        provider: "heuristic",
        error: error instanceof Error ? error.message : "Equipment identification failed.",
      } satisfies EquipmentDetectionResult;
    }
  },
});
