import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { botManager } from "../services/botManager";
import { CITIES } from "../services/nwsService";

export const botRouter = router({
  // ─── Status ────────────────────────────────────────────────────────────────
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const [config, status] = await Promise.all([
      db.getBotConfig(userId),
      db.getBotStatus(userId),
    ]);
    const liveStatus = botManager.getBotStatus(userId);
    return {
      running: liveStatus.running,
      status: status?.status ?? "stopped",
      lastScanAt: status?.lastScanAt ?? null,
      signalsFound: status?.signalsFound ?? 0,
      errorMessage: status?.errorMessage ?? null,
      dryRun: config?.dryRun ?? true,
      isActive: config?.isActive ?? false,
      lastSignals: (liveStatus as any).lastSignals ?? [],
    };
  }),

  // ─── Start ─────────────────────────────────────────────────────────────────
  start: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const config = await db.getBotConfig(userId);
    if (!config?.kalshiApiKey) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Kalshi API key not configured. Go to Settings to add it." });
    }
    await db.upsertBotConfig(userId, { isActive: true });
    await botManager.startBot(userId);
    await db.insertBotLog({ userId, level: "success", message: "Bot started by user" });
    return { success: true };
  }),

  // ─── Stop ──────────────────────────────────────────────────────────────────
  stop: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    await db.upsertBotConfig(userId, { isActive: false });
    await botManager.stopBot(userId);
    await db.insertBotLog({ userId, level: "info", message: "Bot stopped by user" });
    return { success: true };
  }),

  // ─── Restart ───────────────────────────────────────────────────────────────
  restart: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    await botManager.restartBot(userId);
    await db.insertBotLog({ userId, level: "info", message: "Bot restarted by user" });
    return { success: true };
  }),

  // ─── Manual Scan ───────────────────────────────────────────────────────────
  triggerScan: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const signals = await botManager.triggerScan(userId);
    await db.insertBotLog({ userId, level: "info", message: `Manual scan triggered — ${signals.length} signal(s) found` });
    return { signals };
  }),

  // ─── Config ────────────────────────────────────────────────────────────────
  getConfig: protectedProcedure.query(async ({ ctx }) => {
    const config = await db.getBotConfig(ctx.user.id);
    // Never return the raw API key to the client
    if (config?.kalshiApiKey) {
      return { ...config, kalshiApiKey: "••••••••" + config.kalshiApiKey.slice(-4) };
    }
    return config;
  }),

  updateConfig: protectedProcedure
    .input(z.object({
      kalshiApiKey: z.string().optional(),
      dryRun: z.boolean().optional(),
      flatBetDollars: z.number().min(1).max(10000).optional(),
      minEvCents: z.number().min(0).max(50).optional(),
      maxPriceCents: z.number().min(1).max(99).optional(),
      minLiquidity: z.number().min(0).optional(),
      enabledCities: z.array(z.string()).optional(),
      maxDailyTrades: z.number().min(1).max(200).optional(),
      maxDailyLoss: z.number().min(1).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const payload: any = { ...input };
      // Only update API key if a new one is provided (not the masked version)
      if (input.kalshiApiKey && input.kalshiApiKey.startsWith("••••")) {
        delete payload.kalshiApiKey;
      }
      await db.upsertBotConfig(userId, payload);
      await db.insertBotLog({ userId, level: "info", message: "Bot configuration updated" });
      return { success: true };
    }),

  // ─── Trades ────────────────────────────────────────────────────────────────
  getTrades: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }).optional())
    .query(async ({ ctx, input }) => {
      return db.getTradesByUser(ctx.user.id, input?.limit ?? 50, input?.offset ?? 0);
    }),

  getTradeStats: protectedProcedure.query(async ({ ctx }) => {
    return db.getTradeStats(ctx.user.id);
  }),

  getDailyPnl: protectedProcedure
    .input(z.object({ days: z.number().default(14) }).optional())
    .query(async ({ ctx, input }) => {
      return db.getDailyPnl(ctx.user.id, input?.days ?? 14);
    }),

  getOpenTrades: protectedProcedure.query(async ({ ctx }) => {
    return db.getOpenTrades(ctx.user.id);
  }),

  // ─── Logs ──────────────────────────────────────────────────────────────────
  getLogs: protectedProcedure
    .input(z.object({ limit: z.number().default(100) }).optional())
    .query(async ({ ctx, input }) => {
      return db.getBotLogs(ctx.user.id, input?.limit ?? 100);
    }),

  // ─── Forecasts ─────────────────────────────────────────────────────────────
  getForecasts: protectedProcedure.query(async () => {
    return db.getLatestForecasts();
  }),

  getCities: protectedProcedure.query(async () => {
    return Object.values(CITIES).map(({ code, name, seriesTicker }) => ({ code, name, seriesTicker }));
  }),

  // ─── City Stats ────────────────────────────────────────────────────────────
  getCityStats: protectedProcedure.query(async ({ ctx }) => {
    return db.getCityStats(ctx.user.id);
  }),

  // ─── Activity Log ─────────────────────────────────────────────────────────
  getActivityLog: protectedProcedure
    .input(z.object({ limit: z.number().default(100) }).optional())
    .query(async ({ ctx, input }) => {
      return db.getBotLogs(ctx.user.id, input?.limit ?? 100);
    }),

  // ─── Latest Signals ────────────────────────────────────────────────────────
  getLatestSignals: protectedProcedure.query(async ({ ctx }) => {
    return db.getLatestSignals(ctx.user.id);
  }),
});
