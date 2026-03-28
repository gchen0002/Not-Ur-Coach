import { GoogleGenAI } from "@google/genai";
import { actionGeneric, makeFunctionReference, mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { EXERCISE_RESEARCH_CATALOG } from "./researchCatalog";

const exerciseValidator = v.object({
  name: v.string(),
  primaryJoints: v.array(v.string()),
  muscles: v.array(v.string()),
  movementPattern: v.string(),
  biasSummary: v.string(),
  evidenceLevel: v.string(),
  requiredEquipmentNames: v.array(v.string()),
  depthHeuristic: v.union(v.null(), v.any()),
  keyAngleChecks: v.array(v.any()),
});

const researchChunkValidator = v.object({
  source: v.string(),
  sourceType: v.string(),
  text: v.string(),
  exercises: v.array(v.string()),
  muscles: v.array(v.string()),
  embedding: v.array(v.number()),
});

const EQUIPMENT_ALIASES: Record<string, { aliases: string[]; icon?: string }> = {
  Bodyweight: { aliases: ["body weight", "bw", "no equipment"], icon: "person" },
  Barbell: { aliases: ["bar", "olympic bar"], icon: "fitness_center" },
  Bench: { aliases: ["flat bench", "utility bench"], icon: "chair" },
  Dumbbell: { aliases: ["db", "dumbbells"], icon: "fitness_center" },
  "Incline Bench": { aliases: ["angled bench", "adjustable bench"], icon: "chair" },
  "Leg Press Machine": { aliases: ["sled press", "leg press"], icon: "precision_manufacturing" },
  "Leg Curl Machine": { aliases: ["ham curl machine", "seated leg curl", "prone leg curl"], icon: "precision_manufacturing" },
  "Pull-Up Bar": { aliases: ["chin-up bar", "pullup bar"], icon: "horizontal_rule" },
  "Lat Pulldown Machine": { aliases: ["lat pull-down", "pulldown machine"], icon: "precision_manufacturing" },
  "Cable Row Machine": { aliases: ["seated cable row", "cable row"], icon: "precision_manufacturing" },
};

function zeroEmbedding() {
  return Array.from({ length: 768 }, () => 0);
}

async function embedText(ai: GoogleGenAI, text: string) {
  try {
    const response = (await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: text,
      config: { outputDimensionality: 768 },
    })) as {
      embeddings?: Array<{ values?: number[] }>;
      embedding?: { values?: number[] };
    };

    const values = response?.embeddings?.[0]?.values ?? response?.embedding?.values;
    return Array.isArray(values) && values.length === 768 ? values : zeroEmbedding();
  } catch {
    return zeroEmbedding();
  }
}

export const upsertExerciseResearchCatalog = mutationGeneric({
  args: {
    exercises: v.array(exerciseValidator),
    researchChunks: v.array(researchChunkValidator),
  },
  handler: async (ctx, args) => {
    for (const exercise of args.exercises) {
      const equipmentIds = [];

      for (const equipmentName of exercise.requiredEquipmentNames) {
        const existingEquipment = await ctx.db
          .query("equipment")
          .withIndex("by_name", (query) => query.eq("name", equipmentName))
          .first();

        if (existingEquipment) {
          equipmentIds.push(existingEquipment._id);
          continue;
        }

        const metadata = EQUIPMENT_ALIASES[equipmentName] ?? { aliases: [] };
        equipmentIds.push(await ctx.db.insert("equipment", {
          name: equipmentName,
          aliases: metadata.aliases,
          icon: metadata.icon,
        }));
      }

      const existingExercise = await ctx.db
        .query("exercises")
        .withIndex("by_name", (query) => query.eq("name", exercise.name))
        .first();

      const exercisePayload = {
        name: exercise.name,
        primaryJoints: exercise.primaryJoints,
        keyAngleChecks: exercise.keyAngleChecks,
        evidenceLevel: exercise.evidenceLevel,
        isAiGenerated: false,
        requiredEquipment: equipmentIds,
        muscles: exercise.muscles,
        movementPattern: exercise.movementPattern,
        biasSummary: exercise.biasSummary,
        depthHeuristic: exercise.depthHeuristic ?? undefined,
      };

      if (existingExercise) {
        await ctx.db.patch(existingExercise._id, exercisePayload);
      } else {
        await ctx.db.insert("exercises", exercisePayload);
      }
    }

    for (const chunk of args.researchChunks) {
      const existingChunk = await ctx.db
        .query("researchChunks")
        .withIndex("by_source", (query) => query.eq("source", chunk.source))
        .first();

      if (existingChunk) {
        await ctx.db.patch(existingChunk._id, chunk);
      } else {
        await ctx.db.insert("researchChunks", chunk);
      }
    }

    return {
      exerciseCount: args.exercises.length,
      researchChunkCount: args.researchChunks.length,
    };
  },
});

export const seedExerciseResearchCatalog = actionGeneric({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

    const researchChunks = [] as Array<{
      source: string;
      sourceType: string;
      text: string;
      exercises: string[];
      muscles: string[];
      embedding: number[];
    }>;

    for (const exercise of EXERCISE_RESEARCH_CATALOG) {
      for (const chunk of exercise.researchChunks) {
        researchChunks.push({
          ...chunk,
          embedding: ai ? await embedText(ai, chunk.text) : zeroEmbedding(),
        });
      }
    }

    const upsertRef = makeFunctionReference<"mutation", {
      exercises: Array<{
        name: string;
        primaryJoints: string[];
        muscles: string[];
        movementPattern: string;
        biasSummary: string;
        evidenceLevel: string;
        requiredEquipmentNames: string[];
        depthHeuristic: unknown;
        keyAngleChecks: unknown[];
      }>;
      researchChunks: Array<{
        source: string;
        sourceType: string;
        text: string;
        exercises: string[];
        muscles: string[];
        embedding: number[];
      }>;
    }, { exerciseCount: number; researchChunkCount: number }>("researchSeed:upsertExerciseResearchCatalog");

    return await ctx.runMutation(upsertRef, {
      exercises: EXERCISE_RESEARCH_CATALOG.map((entry) => {
        const { researchChunks: nestedResearchChunks, ...exercise } = entry;
        void nestedResearchChunks;
        return exercise;
      }),
      researchChunks,
    });
  },
});

export const upsertBodyweightSquatResearch = upsertExerciseResearchCatalog;
export const seedBodyweightSquatResearch = seedExerciseResearchCatalog;
