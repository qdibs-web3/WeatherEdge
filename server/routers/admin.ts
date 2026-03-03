import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const adminRouter = router({
  getSystemStats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    const [allConfigs] = await Promise.all([db.getAllActiveBotConfigs()]);
    return { activeBots: allConfigs.length };
  }),
});
