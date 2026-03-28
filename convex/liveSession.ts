import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

export const saveSession = mutationGeneric({
  args: {
    sessionId: v.string(),
    source: v.string(),
    exercise: v.optional(v.string()),
    summary: v.string(),
    cues: v.array(v.string()),
    transcript: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
      content: v.string(),
      timestamp: v.number(),
    })),
    createdAt: v.number(),
    endedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("liveSessions")
      .withIndex("by_sessionId", (query) => query.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("liveSessions", args);
    }

    return args.sessionId;
  },
});

export const listRecentSessions = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("liveSessions").collect();
    return sessions
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6);
  },
});
