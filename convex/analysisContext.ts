import { queryGeneric } from "convex/server";
import { v } from "convex/values";

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenize(value: string) {
  return normalizeText(value).split(/\s+/).filter(Boolean);
}

function truncateSentence(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

function inferResistanceType(equipment: string[]) {
  const normalized = equipment.map((item) => normalizeText(item));

  if (normalized.some((item) => item.includes("machine") || item.includes("cable"))) {
    return "machine" as const;
  }

  if (normalized.some((item) => item.includes("bodyweight") || item.includes("body weight"))) {
    return "bodyweight" as const;
  }

  if (normalized.length > 0) {
    return "free_weight" as const;
  }

  return "unknown" as const;
}

export const resolveCompactContext = queryGeneric({
  args: {
    clipName: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const clipName = args.clipName ?? "";
    const clipTokens = new Set(tokenize(clipName));
    const exercises = await ctx.db.query("exercises").collect();
    const equipment = await ctx.db.query("equipment").collect();
    const equipmentById = new Map(equipment.map((item) => [item._id, item.name]));

    const rankedExercises = exercises
      .map((exercise) => {
        const exerciseTokens = new Set(tokenize([
          exercise.name,
          ...(exercise.muscles ?? []),
          exercise.movementPattern ?? "",
          exercise.category ?? "",
        ].join(" ")));
        let score = 0;

        for (const token of clipTokens) {
          if (exerciseTokens.has(token)) {
            score += 1;
          }
        }

        if (clipName && normalizeText(clipName).includes(normalizeText(exercise.name))) {
          score += 4;
        }

        return { exercise, score };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score);

    const resolvedExercise = rankedExercises[0]?.exercise ?? null;
    const requiredEquipment = resolvedExercise?.requiredEquipment
      .map((equipmentId: typeof resolvedExercise.requiredEquipment[number]) => equipmentById.get(equipmentId))
      .filter((item: string | undefined): item is string => Boolean(item)) ?? [];

    const exerciseTokens = new Set(tokenize([
      resolvedExercise?.name ?? clipName,
      ...(resolvedExercise?.muscles ?? []),
      resolvedExercise?.movementPattern ?? "",
    ].join(" ")));
    const researchChunks = await ctx.db.query("researchChunks").collect();
    const evidence = researchChunks
      .map((chunk) => {
        const chunkTokens = new Set(tokenize([
          ...(chunk.exercises ?? []),
          ...(chunk.muscles ?? []),
          chunk.source,
          chunk.text ?? "",
        ].join(" ")));
        let score = 0;

        for (const token of exerciseTokens) {
          if (chunkTokens.has(token)) {
            score += 1;
          }
        }

        return { chunk, score };
      })
      .filter((item) => item.score > 0 && item.chunk.text)
      .sort((left, right) => right.score - left.score)
      .slice(0, 5)
      .map((item, index) => ({
        tier: index === 0 ? "exercise" as const : item.chunk.exercises?.length ? "movement_family" as const : "heuristic" as const,
        finding: truncateSentence(item.chunk.text ?? "", 220),
        source: item.chunk.source,
      }));

    const guardrails = [
      resolvedExercise?.movementPattern
        ? `Coach this as a ${resolvedExercise.movementPattern} pattern, not a generic lift.`
        : null,
      resolvedExercise?.muscles?.length
        ? `Prioritize ${resolvedExercise.muscles.slice(0, 3).join(", ")} as the target muscles.`
        : null,
      resolvedExercise?.biasSummary
        ? truncateSentence(resolvedExercise.biasSummary, 120)
        : null,
      "Do not overclaim when joints are cropped or occluded.",
      "Use short, actionable coaching language tied to visible mechanics.",
    ].filter((item): item is string => Boolean(item)).slice(0, 5);

    return {
      exercise: resolvedExercise
        ? {
            name: resolvedExercise.name,
            muscles: resolvedExercise.muscles,
            movementPattern: resolvedExercise.movementPattern ?? null,
            evidenceLevel: resolvedExercise.evidenceLevel,
            defaultCameraAngle: resolvedExercise.defaultCameraAngle ?? null,
            summary: resolvedExercise.summary ?? resolvedExercise.biasSummary ?? null,
            resistanceType: inferResistanceType(requiredEquipment),
            requiredEquipment,
          }
        : null,
      evidence,
      guardrails,
    };
  },
});
