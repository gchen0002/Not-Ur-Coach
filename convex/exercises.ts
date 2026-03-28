import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

function normalizeEquipmentName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function inferCategory(muscles: string[]) {
  const normalized = muscles.map((muscle) => muscle.toLowerCase());

  if (normalized.some((muscle) => ["quads", "glutes", "hamstrings", "adductors"].includes(muscle))) {
    return "Lower";
  }

  if (normalized.some((muscle) => ["chest", "triceps", "upper chest"].includes(muscle))) {
    return "Upper Push";
  }

  if (normalized.some((muscle) => ["back", "lats", "upper back", "biceps"].includes(muscle))) {
    return "Upper Pull";
  }

  if (normalized.some((muscle) => ["shoulders", "side delts"].includes(muscle))) {
    return "Shoulders";
  }

  return "Custom";
}

export const listCatalog = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const exercises = await ctx.db.query("exercises").collect();
    const equipmentDocs = await ctx.db.query("equipment").collect();
    const equipmentById = new Map(equipmentDocs.map((item) => [item._id, item.name]));

    return exercises.map((exercise) => ({
      name: exercise.name,
      muscles: exercise.muscles,
      category: exercise.category ?? inferCategory(exercise.muscles),
      equipment: exercise.requiredEquipment
        .map((equipmentId: unknown) => equipmentById.get(equipmentId))
        .filter((name: string | undefined): name is string => Boolean(name)),
      defaultCameraAngle: (exercise.defaultCameraAngle ?? "sagittal") as "sagittal" | "coronal" | "angled",
      evidenceLevel: exercise.evidenceLevel,
      isAiGenerated: exercise.isAiGenerated,
      summary: exercise.summary ?? exercise.biasSummary,
    }));
  },
});

export const upsertGeneratedExercise = mutationGeneric({
  args: {
    exercise: v.object({
      name: v.string(),
      muscles: v.array(v.string()),
      category: v.string(),
      equipment: v.array(v.string()),
      defaultCameraAngle: v.union(v.literal("sagittal"), v.literal("coronal"), v.literal("angled")),
      evidenceLevel: v.optional(v.string()),
      isAiGenerated: v.optional(v.boolean()),
      summary: v.string(),
      primaryJoints: v.array(v.string()),
      movementPattern: v.string(),
      referenceVariant: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const names = (args.exercise.equipment.length > 0 ? args.exercise.equipment : ["Bodyweight"])
      .map(normalizeEquipmentName)
      .filter(Boolean);
    const uniqueNames = [...new Set(names)];
    const equipmentIds = [];

    for (const name of uniqueNames) {
      let existing = await ctx.db
        .query("equipment")
        .withIndex("by_name", (query) => query.eq("name", name))
        .first();

      if (!existing) {
        const equipmentId = await ctx.db.insert("equipment", {
          name,
          aliases: [name.toLowerCase()],
        });
        existing = await ctx.db.get(equipmentId);
      }

      if (existing) {
        equipmentIds.push(existing._id);
      }
    }

    const payload = {
      name: args.exercise.name,
      primaryJoints: args.exercise.primaryJoints,
      keyAngleChecks: [],
      evidenceLevel: args.exercise.evidenceLevel ?? "insufficient",
      isAiGenerated: args.exercise.isAiGenerated ?? true,
      requiredEquipment: equipmentIds,
      muscles: args.exercise.muscles,
      category: args.exercise.category,
      summary: args.exercise.summary,
      defaultCameraAngle: args.exercise.defaultCameraAngle,
      movementPattern: args.exercise.movementPattern,
      biasSummary: args.exercise.summary,
    };

    const existing = await ctx.db
      .query("exercises")
      .withIndex("by_name", (query) => query.eq("name", args.exercise.name))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("exercises", payload);
    }

    return {
      name: args.exercise.name,
      muscles: args.exercise.muscles,
      category: args.exercise.category,
      equipment: args.exercise.equipment,
      defaultCameraAngle: args.exercise.defaultCameraAngle,
      evidenceLevel: args.exercise.evidenceLevel ?? "insufficient",
      isAiGenerated: args.exercise.isAiGenerated ?? true,
      summary: args.exercise.summary,
    };
  },
});
