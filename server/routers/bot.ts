import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { botManager } from "../services/botManager";
import { CITIES } from "../services/nwsService";
import { getEnsembleForecast } from "../services/openMeteoService";

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
  // mode: "paper" | "live" | "all" — if omitted, defaults to bot's current dryRun setting
  getTrades: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0), mode: z.enum(["paper", "live", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const config = await db.getBotConfig(ctx.user.id);
      const isPaper = input?.mode === "all" ? null : input?.mode === "paper" ? true : input?.mode === "live" ? false : (config?.dryRun ?? false);
      return db.getTradesByUser(ctx.user.id, input?.limit ?? 50, input?.offset ?? 0, isPaper);
    }),

  getTradeStats: protectedProcedure
    .input(z.object({ mode: z.enum(["paper", "live", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const config = await db.getBotConfig(ctx.user.id);
      const isPaper = input?.mode === "all" ? null : input?.mode === "paper" ? true : input?.mode === "live" ? false : (config?.dryRun ?? false);
      return db.getTradeStats(ctx.user.id, isPaper);
    }),

  getDailyPnl: protectedProcedure
    .input(z.object({ days: z.number().default(14), mode: z.enum(["paper", "live", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const config = await db.getBotConfig(ctx.user.id);
      const isPaper = input?.mode === "all" ? null : input?.mode === "paper" ? true : input?.mode === "live" ? false : (config?.dryRun ?? false);
      return db.getDailyPnl(ctx.user.id, input?.days ?? 14, isPaper);
    }),

  getOpenTrades: protectedProcedure
    .input(z.object({ mode: z.enum(["paper", "live", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const config = await db.getBotConfig(ctx.user.id);
      const isPaper = input?.mode === "all" ? null : input?.mode === "paper" ? true : input?.mode === "live" ? false : (config?.dryRun ?? false);
      return db.getOpenTrades(ctx.user.id, isPaper);
    }),

  markOldTradesSettled: protectedProcedure
    .input(z.object({ daysOld: z.number().default(7) }).optional())
    .mutation(async ({ ctx, input }) => {
      await db.markOldTradesAsSettled(ctx.user.id, input?.daysOld ?? 7);
      return { success: true };
    }),

  // ─── Paper Settlement ───────────────────────────────────────────────────────
  settlePaperTrades: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const config = await db.getBotConfig(userId);
    if (!config?.kalshiApiKey) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Kalshi API key not configured. Go to Settings to add it.",
      });
    }
    const settled = await botManager.settlePaperTradesForUser(userId);
    await db.insertBotLog({
      userId,
      level: "info",
      message: `Manual paper settlement triggered — ${settled} trade(s) settled`,
    });
    return { settled };
  }),

  // ─── Recalculate P&L ────────────────────────────────────────────────────────
  recalculatePnl: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const count = await db.recalculatePaperTradePnl(userId);
    await db.insertBotLog({ userId, level: "info", message: `P&L recalculated for ${count} settled paper trade(s)` });
    return { count };
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

  // Returns Open-Meteo multi-model ensemble data for all cities (cached 20 min)
  getEnsembleForecasts: protectedProcedure.query(async () => {
    const results = await Promise.allSettled(
      Object.values(CITIES).map(async (city) => {
        const today = new Date().toLocaleDateString("en-CA", { timeZone: city.timezone });
        const ensemble = await getEnsembleForecast(city.lat, city.lon, today, city.timezone);
        return {
          cityCode: city.code,
          ensemble,
          date: today,
          directionBias: city.directionBias,
          sigma: city.sigma,
        };
      })
    );
    return results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);
  }),

  getCities: protectedProcedure.query(async () => {
    return Object.values(CITIES).map(({ code, name, seriesTicker }) => ({ code, name, seriesTicker }));
  }),

  // ─── City Stats ────────────────────────────────────────────────────────────
  getCityStats: protectedProcedure.query(async ({ ctx }) => {
    return db.getCityStats(ctx.user.id);
  }),

  // ─── Price Bucket Stats ────────────────────────────────────────────────────
  getPriceBucketStats: protectedProcedure.query(async ({ ctx }) => {
    const trades = await db.getTradesByUser(ctx.user.id, 1000, 0, null);
    const settled = trades.filter((t) => t.status === "settled" && t.won !== null);
    type Bucket = { trades: number; wins: number; losses: number; pnl: number };
    const buckets: Record<string, Bucket> = {
      "5–20¢":  { trades: 0, wins: 0, losses: 0, pnl: 0 },
      "21–45¢": { trades: 0, wins: 0, losses: 0, pnl: 0 },
      "46–80¢": { trades: 0, wins: 0, losses: 0, pnl: 0 },
    };
    for (const t of settled) {
      const price = t.priceCents ?? 0;
      const pnl   = parseFloat(String(t.pnl ?? 0));
      const won   = t.won === true;
      const key   = price <= 20 ? "5–20¢" : price <= 45 ? "21–45¢" : "46–80¢";
      buckets[key].trades++;
      buckets[key].pnl += pnl;
      if (won) buckets[key].wins++; else buckets[key].losses++;
    }
    return Object.entries(buckets).map(([label, v]) => ({
      label,
      trades: v.trades,
      wins: v.wins,
      losses: v.losses,
      winRate: v.trades > 0 ? +(v.wins / v.trades * 100).toFixed(1) : 0,
      pnl: +v.pnl.toFixed(2),
    }));
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

  // ─── Backtest Summary ──────────────────────────────────────────────────────
  // Analyzes all settled paper trades to show win rate breakdown by price, side,
  // probability bucket, and strike type. Used to validate new strategy improvements.
  getBacktestSummary: protectedProcedure.query(async ({ ctx }) => {
    const trades = await db.getTradesByUser(ctx.user.id, 1000, 0, true);
    const settled = trades.filter((t) => t.status === "settled" && t.won !== null);
    if (settled.length === 0) return null;

    type Bucket = { trades: number; wins: number; pnl: number };
    const mkBucket = (): Bucket => ({ trades: 0, wins: 0, pnl: 0 });
    const addTo = (b: Bucket, won: boolean, pnl: number) => {
      b.trades++; if (won) b.wins++; b.pnl += pnl;
    };
    const toStats = (map: Record<string, Bucket>) =>
      Object.entries(map).map(([label, v]) => ({
        label, trades: v.trades, wins: v.wins,
        winRate: v.trades > 0 ? +(v.wins / v.trades * 100).toFixed(1) : 0,
        pnl: +v.pnl.toFixed(2),
      }));

    const byPrice: Record<string, Bucket> = {
      "5-20¢ (longshot)": mkBucket(),
      "21-45¢ (mid)":     mkBucket(),
      "46-80¢ (fav)":     mkBucket(),
    };
    const bySide: Record<string, Bucket>  = { yes: mkBucket(), no: mkBucket() };
    const byProb: Record<string, Bucket>  = {
      "<40% (low conviction)":   mkBucket(),
      "40-55% (borderline)":     mkBucket(),
      "55-70% (conviction)":     mkBucket(),
      "70%+ (high conviction)":  mkBucket(),
    };
    const byStrike: Record<string, Bucket> = {
      greater: mkBucket(), less: mkBucket(), between: mkBucket(),
    };

    for (const t of settled) {
      const price = t.priceCents ?? 0;
      const prob  = t.ourProb   ?? 0;
      const pnl   = parseFloat(String(t.pnl ?? 0));
      const won   = t.won === true;

      const pKey = price <= 20 ? "5-20¢ (longshot)" : price <= 45 ? "21-45¢ (mid)" : "46-80¢ (fav)";
      addTo(byPrice[pKey], won, pnl);

      const sKey = (t.side ?? "yes") as string;
      if (bySide[sKey]) addTo(bySide[sKey], won, pnl);

      const probKey = prob < 0.40 ? "<40% (low conviction)" : prob < 0.55 ? "40-55% (borderline)" : prob < 0.70 ? "55-70% (conviction)" : "70%+ (high conviction)";
      addTo(byProb[probKey], won, pnl);

      const strikeKey = (t.strikeDesc ?? "").startsWith(">") ? "greater" : (t.strikeDesc ?? "").startsWith("<") ? "less" : "between";
      if (byStrike[strikeKey]) addTo(byStrike[strikeKey], won, pnl);
    }

    // ── V2 simulation: what would win rate be if we only took high-conviction trades?
    // Filters to ourProb ≥ 0.60 (proxy for new strategy's 0.70 conviction + 0.12 edge,
    // since old trades used tight sigma which inflated ourProb by ~0.10 vs sigmaMkt).
    const v2Trades = settled.filter((t) => (t.ourProb ?? 0) >= 0.60);
    const v2Wins   = v2Trades.filter((t) => t.won === true).length;
    const v2Pnl    = v2Trades.reduce((s, t) => s + parseFloat(String(t.pnl ?? 0)), 0);

    // ── Projected EV: how much profit per $1 risked at current win rates by bucket
    const evProjection = toStats(byProb).map((b) => {
      // Avg entry price for this bucket (rough: use overall avg)
      const avgPrice = settled.reduce((s, t) => s + (t.priceCents ?? 0), 0) / (settled.length || 1);
      const winRate  = b.winRate / 100;
      const evPerContract = winRate * (100 - avgPrice) * 0.93 - (1 - winRate) * avgPrice;
      return { ...b, evPerContract: +evPerContract.toFixed(2) };
    });

    return {
      totalTrades:    settled.length,
      totalWins:      settled.filter((t) => t.won).length,
      totalPnl:       +settled.reduce((s, t) => s + parseFloat(String(t.pnl ?? 0)), 0).toFixed(2),
      overallWinRate: +(settled.filter((t) => t.won).length / settled.length * 100).toFixed(1),
      byPrice:        toStats(byPrice),
      bySide:         toStats(bySide),
      byProb:         evProjection,
      byStrike:       toStats(byStrike),
      v2Simulation: {
        trades:  v2Trades.length,
        wins:    v2Wins,
        winRate: v2Trades.length > 0 ? +(v2Wins / v2Trades.length * 100).toFixed(1) : 0,
        pnl:     +v2Pnl.toFixed(2),
        skipped: settled.length - v2Trades.length,
        note:    "Trades where stored ourProb ≥ 0.60 (proxy for new 70% conviction + 12% edge filter)",
      },
    };
  }),

  // ─── Param Simulation ──────────────────────────────────────────────────────
  // Retroactively tests different max-price / min-conviction combos against
  // all settled trades already in the DB. Answers: "would these params have
  // been profitable, and would they have found enough trades?"
  getParamSimulation: protectedProcedure.query(async ({ ctx }) => {
    const trades = await db.getTradesByUser(ctx.user.id, 1000, 0, null);
    const settled = trades.filter((t) => t.status === "settled" && t.won !== null && t.pnl != null);

    const scenarios = [
      { label: "Old (80¢ cap, 70% conv)",          maxPrice: 80, minConv: 0.70 },
      { label: "Conservative (45¢ cap, 70% conv)", maxPrice: 45, minConv: 0.70 },
      { label: "New (55¢ cap, 70% conv) ★",        maxPrice: 55, minConv: 0.70 },
      { label: "Aggressive (55¢ cap, 75% conv)",   maxPrice: 55, minConv: 0.75 },
    ];

    return scenarios.map(({ label, maxPrice, minConv }) => {
      const subset = settled.filter(
        (t) => (t.priceCents ?? 0) <= maxPrice && (t.ourProb ?? 0) >= minConv
      );
      const wins   = subset.filter((t) => t.won === true).length;
      const pnl    = subset.reduce((s, t) => s + parseFloat(String(t.pnl ?? 0)), 0);
      return {
        label,
        maxPrice,
        minConv: +(minConv * 100).toFixed(0),
        trades:  subset.length,
        wins,
        losses:  subset.length - wins,
        winRate: subset.length > 0 ? +(wins / subset.length * 100).toFixed(1) : 0,
        pnl:     +pnl.toFixed(2),
        skipped: settled.length - subset.length,
      };
    });
  }),

  // ─── Clear Paper Trades ────────────────────────────────────────────────────
  clearPaperTrades: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    await db.deletePaperTrades(userId);
    await db.insertBotLog({ userId, level: "info", message: "All paper trades cleared by user" });
    return { success: true };
  }),
});
