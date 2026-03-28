import { queryGeneric } from "convex/server";
import { v } from "convex/values";

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toTokenSet(values: string[]) {
  return new Set(
    values
      .map(normalizeToken)
      .flatMap((value) => value.split(/\s+/))
      .filter(Boolean),
  );
}

function countOverlap(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const token of left) {
    if (right.has(token)) {
      count += 1;
    }
  }
  return count;
}

export const listCatalog = queryGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("muscleHeuristics").collect();
  },
});

export const getResearchFramework = queryGeneric({
  args: {
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const name = args.name ?? "hypertrophy-inference-v1";
    return await ctx.db
      .query("researchFrameworks")
      .withIndex("by_name", (query) => query.eq("name", name))
      .first();
  },
});

export const inferForExercise = queryGeneric({
  args: {
    request: v.object({
      exerciseName: v.optional(v.string()),
      muscles: v.optional(v.array(v.string())),
      movementPattern: v.optional(v.string()),
      primaryJoints: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, args) => {
    let exercise = null;

    if (args.request.exerciseName) {
      exercise = await ctx.db
        .query("exercises")
        .withIndex("by_name", (query) => query.eq("name", args.request.exerciseName as string))
        .first();
    }

    const muscles = exercise?.muscles ?? args.request.muscles ?? [];
    const movementPattern = exercise?.movementPattern ?? args.request.movementPattern ?? "";
    const primaryJoints = exercise?.primaryJoints ?? args.request.primaryJoints ?? [];

    const muscleTokens = toTokenSet(muscles);
    const movementTokens = toTokenSet([movementPattern]);
    const jointTokens = toTokenSet(primaryJoints);
    const heuristics = await ctx.db.query("muscleHeuristics").collect();

    const ranked = heuristics
      .map((entry) => {
        const aliasTokens = toTokenSet([entry.targetMuscle, ...(entry.aliases ?? []), entry.muscleRegion ?? ""]);
        const patternTokens = toTokenSet(entry.movementPatterns ?? []);
        const entryJointTokens = toTokenSet(entry.primaryJoints ?? []);

        const muscleScore = countOverlap(muscleTokens, aliasTokens) * 4;
        const patternScore = countOverlap(movementTokens, patternTokens) * 3;
        const jointScore = countOverlap(jointTokens, entryJointTokens) * 2;
        const score = muscleScore + patternScore + jointScore;

        return {
          entry,
          score,
          reasons: [
            muscleScore > 0 ? `muscle overlap +${muscleScore}` : null,
            patternScore > 0 ? `movement overlap +${patternScore}` : null,
            jointScore > 0 ? `joint overlap +${jointScore}` : null,
          ].filter((reason): reason is string => Boolean(reason)),
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);

    return {
      exercise,
      request: {
        exerciseName: args.request.exerciseName ?? exercise?.name ?? null,
        muscles,
        movementPattern: movementPattern || null,
        primaryJoints,
      },
      heuristics: ranked,
    };
  },
});
