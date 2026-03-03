import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const timer = new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms));
  try {
    return await Promise.race([promise, timer]);
  } catch {
    return fallback;
  }
}

export const configRouter = router({
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return db.getUserById(ctx.user.id);
  }),

  updateProfile: protectedProcedure
    .input(z.object({ name: z.string().optional(), avatarUrl: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await db.updateUser(ctx.user.id, input);
      return { success: true };
    }),

  getKalshiBalance: protectedProcedure.query(async ({ ctx }) => {
    const config = await db.getBotConfig(ctx.user.id);
    if (!config?.kalshiApiKey) return null;
    const keyId = (config as any).kalshiApiKeyId ?? "";
    const { KalshiClient } = await import("../services/kalshiClient");
    const client = new KalshiClient(config.kalshiApiKey, keyId);
    try {
      return await withTimeout(client.getBalance(), 8000, null);
    } catch (err: any) {
      console.error("[Kalshi] getBalance error:", err?.message ?? err);
      return null;
    }
  }),

  getKalshiPositions: protectedProcedure.query(async ({ ctx }) => {
    const config = await db.getBotConfig(ctx.user.id);
    if (!config?.kalshiApiKey) return [];
    const keyId = (config as any).kalshiApiKeyId ?? "";
    const { KalshiClient } = await import("../services/kalshiClient");
    const client = new KalshiClient(config.kalshiApiKey, keyId);
    const result = await withTimeout<any>(client.getPositions(), 8000, { market_positions: [] });
    return result?.market_positions ?? [];
  }),

  saveKalshiApiKey: protectedProcedure
    .input(z.object({ apiKey: z.string().min(10), apiKeyId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertBotConfig(ctx.user.id, {
        kalshiApiKey: input.apiKey,
        kalshiApiKeyId: input.apiKeyId,
      } as any);
      return { success: true };
    }),

  getBotConfig: protectedProcedure.query(async ({ ctx }) => {
    const config = await db.getBotConfig(ctx.user.id);
    if (!config) return null;
    return {
      ...config,
      kalshiApiKey: config.kalshiApiKey ? "masked" : null,
      kalshiApiKeyId: (config as any).kalshiApiKeyId ?? null,
    };
  }),

  saveBotConfig: protectedProcedure
    .input(
      z.object({
        flatBetDollars: z.number().min(1).max(10000).optional(),
        minEvCents: z.number().min(0).max(50).optional(),
        maxPriceCents: z.number().min(1).max(99).optional(),
        dryRun: z.boolean().optional(),
        enabledCities: z.array(z.string()).optional(),
        maxDailyTrades: z.number().min(1).max(500).optional(),
        maxDailyLoss: z.number().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db.upsertBotConfig(ctx.user.id, input as any);
      db.insertBotLog({
        userId: ctx.user.id,
        level: "info",
        message: "Bot configuration updated",
      }).catch(() => {});
      return { success: true };
    }),
});
