import type { EquipmentDetectionResult } from "./equipment-detection-contract";

function tokenize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
}

export function createEquipmentDetectionDraft(notes: string | undefined, catalog: string[]): EquipmentDetectionResult {
  const noteTokens = tokenize(notes ?? "");
  const detectedEquipment = catalog
    .map((name) => {
      const nameTokens = tokenize(name);
      const overlap = noteTokens.filter((token) => nameTokens.includes(token)).length;
      return { name, matchedCatalogName: name, confidence: overlap > 0 ? Math.min(0.95, 0.45 + overlap * 0.15) : 0 };
    })
    .filter((item) => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);

  return {
    provider: "heuristic",
    detectedEquipment,
    summary: detectedEquipment.length > 0
      ? `Detected ${detectedEquipment.map((item) => item.matchedCatalogName).join(", ")}.`
      : "Add a quick note about the setup or retry with Gemini configured for image recognition.",
    error: null,
  };
}
