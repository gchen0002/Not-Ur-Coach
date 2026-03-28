import { queryGeneric } from "convex/server";

export const listCatalog = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const equipment = await ctx.db.query("equipment").collect();
    return equipment.map((item) => item.name).sort((a, b) => a.localeCompare(b));
  },
});
