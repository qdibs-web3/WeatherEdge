import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
import { KalshiClient } from "../services/kalshiClient";
import {
  backfillForecastAccuracy,
  backfillKalshiHistory,
} from "../services/historicalDataService";

export const historicalRouter = router({
  // ─── Forecast Accuracy Stats ──────────────────────────────────────────────
  getForecastAccuracyStats: protectedProcedure.query(async () => {
    return db.getForecastAccuracyStats();
  }),

  // ─── Probability Calibration ──────────────────────────────────────────────
  getProbCalibration: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    // Fetch all settled trades with our_prob set
    const trades = await db.getTradesByUser(userId, 500, 0, null);
    const settled = trades.filter(
      (t) => t.status === "settled" && t.ourProb != null
    );

    type Bucket = {
      label: string;
      lowerBound: number;
      trades: number;
      wins: number;
    };

    const buckets: Bucket[] = [
      { label: "60–65%", lowerBound: 0.60, trades: 0, wins: 0 },
      { label: "65–70%", lowerBound: 0.65, trades: 0, wins: 0 },
      { label: "70–75%", lowerBound: 0.70, trades: 0, wins: 0 },
      { label: "75–80%", lowerBound: 0.75, trades: 0, wins: 0 },
      { label: "80–100%", lowerBound: 0.80, trades: 0, wins: 0 },
    ];

    const upperBounds = [0.65, 0.70, 0.75, 0.80, 1.01];

    for (const trade of settled) {
      const prob = trade.ourProb!;
      for (let i = 0; i < buckets.length; i++) {
        if (prob >= buckets[i].lowerBound && prob < upperBounds[i]) {
          buckets[i].trades++;
          if (trade.won) buckets[i].wins++;
          break;
        }
      }
    }

    return buckets
      .filter((b) => b.trades > 0)
      .map((b) => ({
        label: b.label,
        lowerBound: b.lowerBound,
        trades: b.trades,
        wins: b.wins,
        winRate: b.trades > 0 ? Math.round((b.wins / b.trades) * 1000) / 10 : 0,
        avgOurProb: Math.round(b.lowerBound * 100 + 2.5),
      }));
  }),

  // ─── Kalshi History Stats ─────────────────────────────────────────────────
  getKalshiHistoryStats: protectedProcedure.query(async () => {
    return db.getKalshiHistoryStats();
  }),

  // ─── Run Backfill Accuracy (mutation) ────────────────────────────────────
  runBackfillAccuracy: protectedProcedure
    .input(z.object({ daysBack: z.number().default(90) }))
    .mutation(async ({ input }) => {
      const { daysBack } = input;
      // Run in background — don't await so request returns quickly
      backfillForecastAccuracy(daysBack).catch((e) =>
        console.error("[Historical] Backfill accuracy error:", e)
      );
      return { message: `Forecast accuracy backfill started for ${daysBack} days`, daysBack };
    }),

  // ─── Run Backfill Kalshi (mutation) ──────────────────────────────────────
  runBackfillKalshi: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    const config = await db.getBotConfig(userId);
    if (!config?.kalshiApiKey) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Kalshi API key not configured",
      });
    }
    const kalshi = new KalshiClient(
      config.kalshiApiKey,
      config.kalshiApiKeyId ?? ""
    );
    // Run in background
    backfillKalshiHistory(kalshi).catch((e) =>
      console.error("[Historical] Backfill Kalshi error:", e)
    );
    return { message: "Kalshi market history backfill started" };
  }),
});
