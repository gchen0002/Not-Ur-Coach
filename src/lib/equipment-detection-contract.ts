export type EquipmentMatch = {
  name: string;
  matchedCatalogName: string;
  confidence: number;
};

export type EquipmentDetectionRequest = {
  imageDataUrl: string;
  notes?: string;
};

export type EquipmentDetectionResult = {
  provider: "gemini" | "heuristic";
  detectedEquipment: EquipmentMatch[];
  summary: string;
  error: string | null;
};
