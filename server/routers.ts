import { router } from "./_core/trpc";
import { botRouter } from "./routers/bot";
import { configRouter } from "./routers/config";
import { adminRouter } from "./routers/admin";
import { authRouter } from "./routers/auth";
import { historicalRouter } from "./routers/historical";

export const appRouter = router({
  auth: authRouter,
  bot: botRouter,
  config: configRouter,
  admin: adminRouter,
  historical: historicalRouter,
});

export type AppRouter = typeof appRouter;
