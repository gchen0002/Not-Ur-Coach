import type {
  ExerciseCatalogEntry,
  GeneratedExerciseDraft,
  ExerciseIntakeRequest,
  ExerciseIntakeResult,
} from "./exercise-intake-contract";
import { createReferenceClipRequestFromExercise } from "./reference-clip-draft";

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function scoreEntry(description: string, entry: ExerciseCatalogEntry) {
  const descriptionTokens = tokenize(description);
  const haystack = tokenize(`${entry.name} ${entry.muscles.join(" ")} ${entry.category}`);
  const overlap = descriptionTokens.filter((token) => haystack.includes(token)).length;

  return overlap;
}

function pickCategory(description: string) {
  const normalized = description.toLowerCase();

  if (/(squat|lunge|split squat|rdl|deadlift|hip thrust|leg press|leg curl|rfess)/.test(normalized)) {
    return "Lower";
  }

  if (/(bench|press|push-up|incline|overhead)/.test(normalized)) {
    return "Upper Push";
  }

  if (/(row|pull|pulldown|chin-up)/.test(normalized)) {
    return "Upper Pull";
  }

  if (/(curl|tricep|bicep)/.test(normalized)) {
    return "Arms";
  }

  if (/(raise|delt|shoulder)/.test(normalized)) {
    return "Shoulders";
  }

  return "Custom";
}

function pickMuscles(description: string) {
  const normalized = description.toLowerCase();
  const muscles = new Set<string>();

  if (/(squat|lunge|leg press|rfess)/.test(normalized)) {
    muscles.add("Quads");
  }

  if (/(rdl|deadlift|curl)/.test(normalized)) {
    muscles.add("Hamstrings");
  }

  if (/(squat|rdl|deadlift|hip thrust|rfess|glute)/.test(normalized)) {
    muscles.add("Glutes");
  }

  if (/(bench|incline|push-up|chest)/.test(normalized)) {
    muscles.add("Chest");
  }

  if (/(row|pull|pulldown|chin-up|lat)/.test(normalized)) {
    muscles.add("Back");
  }

  if (/(overhead|raise|shoulder|press)/.test(normalized)) {
    muscles.add("Shoulders");
  }

  if (/(curl|row|pull)/.test(normalized)) {
    muscles.add("Biceps");
  }

  if (/(tricep|press|push-up)/.test(normalized)) {
    muscles.add("Triceps");
  }

  return muscles.size > 0 ? [...muscles] : ["Unknown"];
}

function pickEquipment(description: string) {
  const normalized = description.toLowerCase();
  const equipment = new Set<string>();

  if (normalized.includes("barbell")) {
    equipment.add("Barbell");
  }

  if (/(dumbbell|db)/.test(normalized)) {
    equipment.add("Dumbbells");
  }

  if (normalized.includes("kettlebell")) {
    equipment.add("Kettlebell");
  }

  if (normalized.includes("cable")) {
    equipment.add("Cable Machine");
  }

  if (normalized.includes("band")) {
    equipment.add("Resistance Band");
  }

  if (normalized.includes("machine")) {
    equipment.add("Machine");
  }

  return equipment.size > 0 ? [...equipment] : ["Bodyweight"];
}

function pickPrimaryJoints(description: string) {
  const normalized = description.toLowerCase();

  if (/(squat|lunge|rfess|leg press)/.test(normalized)) {
    return ["knee", "hip", "ankle"];
  }

  if (/(rdl|deadlift|hip thrust|curl)/.test(normalized)) {
    return ["hip", "knee"];
  }

  if (/(bench|press|raise|push-up)/.test(normalized)) {
    return ["shoulder", "elbow"];
  }

  if (/(row|pull|pulldown|chin-up|curl)/.test(normalized)) {
    return ["shoulder", "elbow"];
  }

  return ["hip", "knee"];
}

function pickCameraAngle(category: string): ExerciseCatalogEntry["defaultCameraAngle"] {
  if (category === "Upper Pull" || category === "Upper Push" || category === "Shoulders" || category === "Arms") {
    return "angled";
  }

  return "sagittal";
}

function createGeneratedExerciseDraft(description: string): GeneratedExerciseDraft {
  const normalized = description.trim();
  const category = pickCategory(normalized);
  const equipment = pickEquipment(normalized);
  const title = normalized.length > 0
    ? normalized
        .split(/\s+/)
        .slice(0, 4)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
    : "Custom Exercise";

  return {
    name: title,
    muscles: pickMuscles(normalized),
    category,
    equipment,
    defaultCameraAngle: pickCameraAngle(category),
    evidenceLevel: "insufficient",
    isAiGenerated: true,
    summary: "This does not appear to match the seeded catalog closely, so it needs an AI-generated exercise profile and reference clip.",
    primaryJoints: pickPrimaryJoints(normalized),
    movementPattern: category === "Lower" ? "lower body compound" : category.toLowerCase(),
    referenceVariant: `${equipment[0]?.toLowerCase() ?? "custom"} demo`,
  };
}

export { createGeneratedExerciseDraft };

export function resolveExerciseIntake(
  request: ExerciseIntakeRequest,
  catalog: ExerciseCatalogEntry[],
): ExerciseIntakeResult {
  const ranked = [...catalog]
    .map((entry) => ({ entry, score: scoreEntry(request.description, entry) }))
    .sort((a, b) => b.score - a.score);

  const suggestions = ranked.filter((item) => item.score > 0).slice(0, 3).map((item) => item.entry);
  const top = ranked[0];

  if (top && top.score >= 2) {
    return {
      provider: "heuristic",
      status: "matched",
      matchedExercise: top.entry,
      generatedExercise: null,
      suggestions,
      referenceRequest: null,
      error: null,
    };
  }

  const normalized = request.description.trim();
  const generatedExercise = normalized.length >= 6 ? createGeneratedExerciseDraft(normalized) : null;

  return {
    provider: "heuristic",
    status: normalized.length >= 6 ? "generated" : "unclear",
    matchedExercise: null,
    generatedExercise,
    suggestions,
    referenceRequest: generatedExercise
      ? createReferenceClipRequestFromExercise(generatedExercise, { variant: generatedExercise.referenceVariant })
      : null,
    error: normalized.length >= 6 ? null : "Add a little more detail so the app can tell whether this already exists.",
  };
}
