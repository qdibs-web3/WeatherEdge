/**
 * Bot Integration Service
 * 
 * This service manages the Polymarket trading bot lifecycle and integrates it with the dashboard.
 * It handles starting/stopping the bot, monitoring its status, and recording trades to the database.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { getDb } from '../server/db';
import { trades, positions, botStatus, botLogs, marketOpportunities } from '../drizzle/schema';
import { eq, and, desc } from 'drizzle-orm';

interface BotConfig {
  maxPositionSize: number;
  maxOpenPositions: number;
  maxDailyLoss: number;
  targetDailyReturn: number;
  minEdge: number;
  kellyFraction: number;
  arbitrageEnabled: boolean;
  arbitrageMinProfitPct: number;
  valueBettingEnabled: boolean;
  highQualityMarketsEnabled: boolean;
  minVolume: number;
  minQualityScore: number;
  runIntervalSeconds: number;
}

class BotService {
  private botProcess: ChildProcess | null = null;
  private userId: number = 1; // Default user ID
  private isRunning: boolean = false;

  /**
   * Start the trading bot
   */
  async start(config: BotConfig): Promise<void> {
    if (this.isRunning) {
      throw new Error('Bot is already running');
    }

    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      // Update bot status to starting
      await db.insert(botStatus).values({
        userId: this.userId,
        status: 'starting',
        isActive: true,
        lastStartedAt: new Date(),
      }).onDuplicateKeyUpdate({
        set: {
          status: 'starting',
          isActive: true,
          lastStartedAt: new Date(),
          errorMessage: null,
        },
      });

      // Log bot start
      await this.log('info', 'Bot starting with configuration', JSON.stringify(config));

      // Start the Python bot process
      const botPath = path.join(__dirname, '../../polymarket_bot/src/bot.py');
      
      this.botProcess = spawn('python3', [botPath], {
        env: {
          ...process.env,
          BOT_CONFIG: JSON.stringify(config),
        },
      });

      this.botProcess.stdout?.on('data', (data) => {
        const message = data.toString().trim();
        console.log(`[Bot] ${message}`);
        this.log('info', message);
      });

      this.botProcess.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        console.error(`[Bot Error] ${message}`);
        this.log('error', message);
      });

      this.botProcess.on('exit', (code) => {
        console.log(`[Bot] Process exited with code ${code}`);
        this.isRunning = false;
        this.handleBotExit(code);
      });

      this.isRunning = true;

      // Update status to running
      await db.update(botStatus)
        .set({
          status: 'running',
          lastCycleAt: new Date(),
        })
        .where(eq(botStatus.userId, this.userId));

      await this.log('info', 'Bot started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.log('error', `Failed to start bot: ${errorMessage}`);
      
      await db.update(botStatus)
        .set({
          status: 'stopped',
          isActive: false,
          errorMessage,
        })
        .where(eq(botStatus.userId, this.userId));

      throw error;
    }
  }

  /**
   * Stop the trading bot
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.botProcess) {
      throw new Error('Bot is not running');
    }

    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      await this.log('info', 'Stopping bot...');

      // Gracefully terminate the bot process
      this.botProcess.kill('SIGTERM');

      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Force kill if still running
      if (this.isRunning) {
        this.botProcess.kill('SIGKILL');
      }

      this.isRunning = false;
      this.botProcess = null;

      // Update bot status
      await db.update(botStatus)
        .set({
          status: 'stopped',
          isActive: false,
          lastStoppedAt: new Date(),
        })
        .where(eq(botStatus.userId, this.userId));

      await this.log('info', 'Bot stopped successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.log('error', `Failed to stop bot: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get current bot status
   */
  async getStatus() {
    const db = await getDb();
    if (!db) {
      return null;
    }

    const result = await db.select()
      .from(botStatus)
      .where(eq(botStatus.userId, this.userId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Get bot logs
   */
  async getLogs(limit: number = 100) {
    const db = await getDb();
    if (!db) {
      return [];
    }

    return await db.select()
      .from(botLogs)
      .where(eq(botLogs.userId, this.userId))
      .orderBy(desc(botLogs.timestamp))
      .limit(limit);
  }

  /**
   * Log a message
   */
  private async log(level: 'info' | 'warning' | 'error', message: string, metadata?: string) {
    const db = await getDb();
    if (!db) {
      return;
    }

    try {
      await db.insert(botLogs).values({
        userId: this.userId,
        level,
        message,
        metadata,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Failed to log message:', error);
    }
  }

  /**
   * Handle bot process exit
   */
  private async handleBotExit(code: number | null) {
    const db = await getDb();
    if (!db) {
      return;
    }

    const status = code === 0 ? 'stopped' : 'error';
    const errorMessage = code !== 0 ? `Bot exited with code ${code}` : null;

    await db.update(botStatus)
      .set({
        status,
        isActive: false,
        lastStoppedAt: new Date(),
        errorMessage,
      })
      .where(eq(botStatus.userId, this.userId));

    if (code !== 0) {
      await this.log('error', `Bot crashed with exit code ${code}`);
    }
  }

  /**
   * Record a trade
   */
  async recordTrade(tradeData: {
    marketId: string;
    marketQuestion: string;
    strategy: 'arbitrage' | 'value_betting' | 'high_quality';
    side: 'yes' | 'no' | 'both';
    entryPrice: number;
    quantity: number;
    entryValue: number;
  }) {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    await db.insert(trades).values({
      userId: this.userId,
      ...tradeData,
      status: 'open',
      entryTime: new Date(),
    });

    await this.log('info', `Trade recorded: ${tradeData.marketQuestion} (${tradeData.strategy})`);
  }

  /**
   * Update a trade (close, update P&L, etc.)
   */
  async updateTrade(tradeId: number, updates: {
    exitPrice?: number;
    exitValue?: number;
    exitTime?: Date;
    pnl?: number;
    pnlPct?: number;
    status?: 'open' | 'closed' | 'cancelled';
  }) {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    await db.update(trades)
      .set(updates)
      .where(eq(trades.id, tradeId));

    await this.log('info', `Trade ${tradeId} updated`);
  }

  /**
   * Record market opportunities
   */
  async recordOpportunities(opportunities: Array<{
    marketId: string;
    marketQuestion: string;
    opportunityType: 'arbitrage' | 'value_bet' | 'high_quality';
    yesPrice?: number;
    noPrice?: number;
    combinedCost?: number;
    profitPct?: number;
    volume?: number;
    liquidity?: number;
    qualityScore?: number;
    maxPosition?: number;
    expiresAt: Date;
  }>) {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    for (const opp of opportunities) {
      await db.insert(marketOpportunities).values({
        userId: this.userId,
        ...opp,
      });
    }

    await this.log('info', `Recorded ${opportunities.length} market opportunities`);
  }
}

// Export singleton instance
export const botService = new BotService();
