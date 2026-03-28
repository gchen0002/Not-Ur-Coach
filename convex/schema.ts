import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.optional(v.string()),
    mode: v.union(v.literal("nerd"), v.literal("basic")),
    savedEquipment: v.array(v.id("equipment")),
  }).index("by_clerkId", ["clerkId"]),

  clips: defineTable({
    userId: v.id("users"),
    exercise: v.string(),
    resistanceType: v.union(
      v.literal("bodyweight"),
      v.literal("free_weight"),
      v.literal("machine"),
      v.literal("cable"),
      v.literal("band"),
    ),
    cameraAngle: v.optional(v.string()),
    jointConfidence: v.optional(v.number()),
    sessionIntent: v.optional(
      v.union(
        v.literal("form_check"),
        v.literal("work_set"),
        v.literal("1rm_attempt"),
      ),
    ),
    status: v.union(
      v.literal("processing"),
      v.literal("analyzed"),
      v.literal("failed"),
    ),
  }).index("by_userId", ["userId"]),

  poseData: defineTable({
    clipId: v.id("clips"),
    landmarkData: v.string(),
    angleTimeSeries: v.optional(v.any()),
  }).index("by_clipId", ["clipId"]),

  reps: defineTable({
    clipId: v.id("clips"),
    repNumber: v.number(),
    angles: v.any(),
    tempo: v.optional(v.any()),
    rom: v.optional(v.any()),
    symmetry: v.optional(v.any()),
    momentArms: v.optional(v.any()),
    peakTensionPosition: v.optional(v.string()),
  }).index("by_clipId", ["clipId"]),

  analyses: defineTable({
    clipId: v.id("clips"),
    userId: v.id("users"),
    scores: v.object({
      overall: v.number(),
      rom: v.number(),
      tensionProfile: v.number(),
      tempo: v.number(),
      symmetry: v.number(),
      fatigueManagement: v.optional(v.number()),
    }),
    nerdAnalysis: v.any(),
    basicAnalysis: v.any(),
    cues: v.array(v.any()),
    risks: v.array(v.string()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    embedding: v.optional(v.array(v.number())),
    inferredIntent: v.optional(
      v.union(
        v.literal("form_check"),
        v.literal("work_set"),
        v.literal("1rm_attempt"),
      ),
    ),
  })
    .index("by_clipId", ["clipId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["userId"],
    }),

  researchChunks: defineTable({
    source: v.string(),
    sourceType: v.string(),
    text: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    exercises: v.array(v.string()),
    muscles: v.array(v.string()),
    embedding: v.array(v.number()),
  }).vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: 768,
    filterFields: ["sourceType"],
  }),

  clipFrameEmbeddings: defineTable({
    clipId: v.id("clips"),
    exercise: v.string(),
    position: v.string(),
    embedding: v.array(v.number()),
  })
    .index("by_clipId", ["clipId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 768,
      filterFields: ["exercise", "position"],
    }),

  exercises: defineTable({
    name: v.string(),
    primaryJoints: v.array(v.string()),
    keyAngleChecks: v.array(v.any()),
    evidenceLevel: v.string(),
    isAiGenerated: v.boolean(),
    requiredEquipment: v.array(v.id("equipment")),
    muscles: v.array(v.string()),
    referenceClipStorageId: v.optional(v.id("_storage")),
  }).index("by_name", ["name"]),

  referenceVideos: defineTable({
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
  }).index("by_exercise", ["exercise"]),

  equipment: defineTable({
    name: v.string(),
    aliases: v.array(v.string()),
    icon: v.optional(v.string()),
  }).index("by_name", ["name"]),

  messages: defineTable({
    userId: v.id("users"),
    clipId: v.optional(v.id("clips")),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    groundingMetadata: v.optional(v.any()),
  }).index("by_userId", ["userId"]),
});
