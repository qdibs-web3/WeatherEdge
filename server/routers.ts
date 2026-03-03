import { router } from "./_core/trpc";
import { botRouter } from "./routers/bot";
import { configRouter } from "./routers/config";
import { adminRouter } from "./routers/admin";
import { authRouter } from "./routers/auth";

export const appRouter = router({
  auth: authRouter,
  bot: botRouter,
  config: configRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
