import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const getByCacheKey = queryGeneric({
  args: {
    cacheKey: v.string(),
  },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("tempoTracks")
      .withIndex("by_cacheKey", (query) => query.eq("cacheKey", args.cacheKey))
      .first();

    if (!record) {
      return null;
    }

    return {
      ...record,
      audioUrl: record.storageId ? await ctx.storage.getUrl(record.storageId) : null,
    };
  },
});

export const upsert = mutationGeneric({
  args: {
    cacheKey: v.string(),
    bpm: v.number(),
    tempoPattern: v.string(),
    style: v.string(),
    prompt: v.string(),
    provider: v.string(),
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tempoTracks")
      .withIndex("by_cacheKey", (query) => query.eq("cacheKey", args.cacheKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("tempoTracks", args);
    }

    return true;
  },
});
