import { WeatherBot, BotConfig } from "../bots/weatherBot";
import { KalshiClient } from "./kalshiClient";
import { NwsService, CITIES } from "./nwsService";
import * as db from "../db";

class BotManager {
  private static instance: BotManager | null = null;
  private bots: Map<number, WeatherBot> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;
  private settlementInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): BotManager {
    if (!BotManager.instance) BotManager.instance = new BotManager();
    return BotManager.instance;
  }

  async initialize() {
    console.log("[BotManager] Initializing...");
    this.syncInterval = setInterval(() => this.syncBots(), 60_000);
    this.settlementInterval = setInterval(async () => {
      await this.syncSettlements();
      await this.syncPaperSettlements();
    }, 300_000); // Every 5 minutes
    await this.syncBots();
    await this.syncSettlements();
    await this.syncPaperSettlements();
  }

  async shutdown() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.settlementInterval) clearInterval(this.settlementInterval);
    await this.stopAllBots();
  }

  async startBot(userId: number): Promise<void> {
    if (this.bots.has(userId)) {
      const existing = this.bots.get(userId)!;
      if (existing.isRunning()) throw new Error("Bot is already running");
      this.bots.delete(userId);
    }

    const user = await db.getUserById(userId);
    if (!user) throw new Error("User not found");

    const config = await db.getBotConfig(userId);
    if (!config) throw new Error("Bot configuration not found");
    if (!config.kalshiApiKey) throw new Error("Kalshi API key not configured. Go to Settings to add it.");
    const kalshiKeyId = (config as any).kalshiApiKeyId ?? "";
    const kalshi = new KalshiClient(config.kalshiApiKey, kalshiKeyId);
    const nws = new NwsService(
      process.env.NWS_USER_AGENT || "(KalshiWeatherBot, admin@example.com)"
    );

    const botConfig: BotConfig = {
      userId,
      flatBetDollars: config.flatBetDollars ?? 20,
      minEvCents: config.minEvCents ?? 3,
      maxPriceCents: config.maxPriceCents ?? 70,
      minLiquidity: config.minLiquidity ?? 100,
      enabledCities: config.enabledCities ?? Object.keys(CITIES),
      dryRun: config.dryRun ?? false,
      maxDailyTrades: config.maxDailyTrades ?? 20,
    };

    const bot = new WeatherBot(kalshi, nws, botConfig);
    await bot.start();
    this.bots.set(userId, bot);
    await db.upsertBotStatus({ userId, status: "running", errorMessage: null });
    console.log(`[BotManager] Bot started for user ${userId}`);
  }

  async stopBot(userId: number): Promise<void> {
    const bot = this.bots.get(userId);
    if (!bot) return;
    await bot.stop();
    this.bots.delete(userId);
    await db.upsertBotStatus({ userId, status: "stopped", errorMessage: null });
  }

  async restartBot(userId: number): Promise<void> {
    await this.stopBot(userId);
    await this.startBot(userId);
  }

  async stopAllBots(): Promise<void> {
    await Promise.all(Array.from(this.bots.keys()).map((id) => this.stopBot(id)));
  }

  getBotStatus(userId: number) {
    const bot = this.bots.get(userId);
    if (!bot) return { running: false, exists: false, scanMode: 'idle' };
    return { exists: true, ...bot.getStatus() };
  }

  async triggerScan(userId: number) {
    const bot = this.bots.get(userId);
    if (!bot || !bot.isRunning()) throw new Error("Bot is not running");
    return bot.scan();
  }

  getActiveBotCount() { return this.bots.size; }

  getStatistics() {
    return {
      activeBots: this.bots.size,
      activeUserIds: Array.from(this.bots.keys()),
    };
  }

  private async syncBots() {
    try {
      const activeConfigs = await db.getAllActiveBotConfigs();
      const activeIds = new Set(activeConfigs.map((c: any) => c.userId));
      for (const userId of Array.from(activeIds)) {
        if (!this.bots.has(userId) || !this.bots.get(userId)!.isRunning()) {
          // Only auto-start bots that were previously running
          const status = await db.getBotStatus(userId);
          if (status?.status === "running") {
            try { await this.startBot(userId); }
            catch (err: any) {
              await db.upsertBotStatus({ userId, status: "error", errorMessage: err.message });
            }
          }
        }
      }
      for (const userId of Array.from(this.bots.keys())) {
        if (!activeIds.has(userId)) await this.stopBot(userId);
      }
    } catch (err) { console.error("[BotManager] Sync error:", err); }
  }

  /**
   * Settle all open paper trades for a single user by querying the Kalshi API
   * for each unique market ticker that still has open paper positions.
   * Returns the total number of paper trades settled.
   */
  async settlePaperTradesForUser(userId: number): Promise<number> {
    const config = await db.getBotConfig(userId);
    if (!config?.kalshiApiKey) {
      throw new Error("Kalshi API key not configured for this user.");
    }

    const kalshiKeyId = (config as any).kalshiApiKeyId ?? "";
    const kalshi = new KalshiClient(config.kalshiApiKey, kalshiKeyId);

    // Fetch every open paper trade for this user
    const openPaperTrades = await db.getOpenTrades(userId, true);
    if (openPaperTrades.length === 0) {
      console.log(`[BotManager] No open paper trades for user ${userId}`);
      return 0;
    }

    // Deduplicate tickers
    const uniqueTickers = Array.from(new Set(
      openPaperTrades.map((t) => t.marketTicker).filter(Boolean) as string[]
    ));

    console.log(
      `[BotManager] Checking ${uniqueTickers.length} ticker(s) for paper settlement (user ${userId})`
    );

    let totalSettled = 0;

    for (const ticker of uniqueTickers) {
      try {
        const market = await kalshi.getMarket(ticker);

        // A market is settled when its status is 'settled' OR when the result field is present
        const marketResult: string | undefined = (market as any).result;
        const isSettled =
          market.status === "settled" ||
          (typeof marketResult === "string" && marketResult !== "");

        if (!isSettled) {
          console.log(`[BotManager] Market ${ticker} not yet settled (status: ${market.status})`);
          continue;
        }

        // Normalise result to "yes" | "no"
        const resultNorm = (marketResult ?? "").toLowerCase();
        if (resultNorm !== "yes" && resultNorm !== "no") {
          console.warn(
            `[BotManager] Market ${ticker} has unexpected result value: "${marketResult}" — skipping`
          );
          continue;
        }

        const settled = await db.settlePaperTradesByTicker(
          userId,
          ticker,
          resultNorm as "yes" | "no"
        );
        totalSettled += settled;
      } catch (err: any) {
        console.error(
          `[BotManager] Error checking settlement for ${ticker} (user ${userId}): ${err.message}`
        );
      }
    }

    console.log(
      `[BotManager] Paper settlement complete for user ${userId}: ${totalSettled} trade(s) settled`
    );
    return totalSettled;
  }

  /**
   * Run paper settlement across every user that has an active bot config.
   * Integrated into the same 5-minute interval as live settlement.
   */
  private async syncPaperSettlements() {
    try {
      const activeConfigs = await db.getAllActiveBotConfigs();
      const userIds = Array.from(new Set(activeConfigs.map((c: any) => c.userId)));

      for (const userId of userIds) {
        try {
          await this.settlePaperTradesForUser(userId);
        } catch (err: any) {
          // Don't let one user's failure break the loop
          console.error(
            `[BotManager] Paper settlement sync error for user ${userId}: ${err.message}`
          );
        }
      }
    } catch (err) {
      console.error("[BotManager] Paper settlement sync error:", err);
    }
  }

  private async syncSettlements() {
    try {
      console.log("[BotManager] Starting settlement sync...");
      // Get all users with active bot configs
      const activeConfigs = await db.getAllActiveBotConfigs();
      const userIds = Array.from(new Set(activeConfigs.map((c: any) => c.userId)));
      console.log(`[BotManager] Found ${userIds.length} users with active configs`);

      for (const userId of userIds) {
        try {
          const config = await db.getBotConfig(userId);
          if (!config?.kalshiApiKey) {
            console.log(`[BotManager] Skipping user ${userId} - no Kalshi API key`);
            continue;
          }

          const kalshiKeyId = (config as any).kalshiApiKeyId ?? "";
          const kalshi = new KalshiClient(config.kalshiApiKey, kalshiKeyId);

          // Fetch settlements - start with recent ones, then expand if needed
          let allSettlements: any[] = [];
          let cursor: string | undefined;
          let pageCount = 0;

          do {
            const result = await kalshi.getPortfolioSettlements({
              limit: 100,
              cursor
            });
            const settlements = result.settlements || [];
            console.log(`[BotManager] User ${userId} - fetched ${settlements.length} settlements (page ${pageCount + 1})`);
            allSettlements = allSettlements.concat(settlements);
            cursor = result.cursor;
            pageCount++;
          } while (cursor && pageCount < 5); // Limit to 5 pages to avoid too many API calls

          console.log(`[BotManager] User ${userId} - total settlements fetched: ${allSettlements.length}`);

          if (allSettlements.length > 0) {
            // Log first settlement for debugging
            console.log(`[BotManager] Sample settlement:`, JSON.stringify(allSettlements[0], null, 2));

            await db.updateTradeSettlements(userId, allSettlements);
            console.log(`[BotManager] Updated ${allSettlements.length} settlements for user ${userId}`);
          } else {
            console.log(`[BotManager] No settlements found for user ${userId}`);
          }

          // Force-settle any filled trades older than 3 days that weren't matched by ticker
          await db.markOldTradesAsSettled(userId, 3);
        } catch (err: any) {
          console.error(`[BotManager] Settlement sync error for user ${userId}:`, err.message);
        }
      }
      console.log("[BotManager] Settlement sync completed");
    } catch (err) { 
      console.error("[BotManager] Settlement sync error:", err); 
    }
  }
}

export const botManager = BotManager.getInstance();
