import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const getByExercise = queryGeneric({
  args: {
    exercise: v.string(),
  },
  handler: async (ctx, args) => {
    const reference = await ctx.db
      .query("referenceVideos")
      .withIndex("by_exercise", (query) => query.eq("exercise", args.exercise))
      .first();

    if (!reference) {
      return null;
    }

    const storageUrl = reference.storageId ? await ctx.storage.getUrl(reference.storageId) : null;

    return {
      ...reference,
      storageUrl,
    };
  },
});

export const upsertReferenceVideo = mutationGeneric({
  args: {
    exercise: v.string(),
    variant: v.string(),
    cameraAngle: v.string(),
    model: v.string(),
    provider: v.string(),
    storageId: v.optional(v.id("_storage")),
    sourceUri: v.optional(v.string()),
    promptPackage: v.any(),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("referenceVideos")
      .withIndex("by_exercise", (query) => query.eq("exercise", args.exercise))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("referenceVideos", args);
    }

    const exercise = await ctx.db
      .query("exercises")
      .withIndex("by_name", (query) => query.eq("name", args.exercise))
      .first();

    if (exercise && args.storageId) {
      await ctx.db.patch(exercise._id, { referenceClipStorageId: args.storageId });
    }

    return true;
  },
});
