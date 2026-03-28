import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const DEMO_CLERK_ID = "demo-user";

export const getSavedEquipment = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (query) => query.eq("clerkId", DEMO_CLERK_ID))
      .first();

    if (!user) {
      return [];
    }

    const equipmentDocs = await Promise.all(user.savedEquipment.map((equipmentId: typeof user.savedEquipment[number]) => ctx.db.get(equipmentId)));
    return equipmentDocs
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => item.name)
      .sort((a, b) => a.localeCompare(b));
  },
});

export const saveSavedEquipment = mutationGeneric({
  args: {
    names: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    let user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (query) => query.eq("clerkId", DEMO_CLERK_ID))
      .first();

    if (!user) {
      const userId = await ctx.db.insert("users", {
        clerkId: DEMO_CLERK_ID,
        name: "Demo User",
        mode: "basic",
        savedEquipment: [],
      });
      user = await ctx.db.get(userId);
    }

    if (!user) {
      return [];
    }

    const uniqueNames = [...new Set(args.names.map((name) => name.trim()).filter(Boolean))];
    const equipmentIds = [];

    for (const name of uniqueNames) {
      let equipment = await ctx.db
        .query("equipment")
        .withIndex("by_name", (query) => query.eq("name", name))
        .first();

      if (!equipment) {
        const equipmentId = await ctx.db.insert("equipment", {
          name,
          aliases: [name.toLowerCase()],
        });
        equipment = await ctx.db.get(equipmentId);
      }

      if (equipment) {
        equipmentIds.push(equipment._id);
      }
    }

    await ctx.db.patch(user._id, { savedEquipment: equipmentIds });
    return uniqueNames;
  },
});
