import { WeatherBot, BotConfig } from "../bots/weatherBot";
import { KalshiClient } from "./kalshiClient";
import { NwsService, CITIES } from "./nwsService";
import * as db from "../db";

class BotManager {
  private static instance: BotManager | null = null;
  private bots: Map<number, WeatherBot> = new Map();
  private syncInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  static getInstance(): BotManager {
    if (!BotManager.instance) BotManager.instance = new BotManager();
    return BotManager.instance;
  }

  async initialize() {
    console.log("[BotManager] Initializing...");
    this.syncInterval = setInterval(() => this.syncBots(), 60_000);
    await this.syncBots();
  }

  async shutdown() {
    if (this.syncInterval) clearInterval(this.syncInterval);
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
          try { await this.startBot(userId); }
          catch (err: any) {
            await db.upsertBotStatus({ userId, status: "error", errorMessage: err.message });
          }
        }
      }
      for (const userId of Array.from(this.bots.keys())) {
        if (!activeIds.has(userId)) await this.stopBot(userId);
      }
    } catch (err) { console.error("[BotManager] Sync error:", err); }
  }
}

export const botManager = BotManager.getInstance();
