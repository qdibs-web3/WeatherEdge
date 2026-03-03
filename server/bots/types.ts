/**
 * Shared types for BTC 15m bot
 */

export interface TradeSignal {
  direction: 'UP' | 'DOWN';
  confidence: number;     // 0–100
  edge: number;           // Raw edge before fees (0–1)
  netEdge?: number;       // Edge after fee consideration (0–1)
  timestamp: Date;
  marketId: string;
  marketQuestion: string;
  entryPrice: number;     // Market price of the token (0–1)
  reasoning: string;

  // TA indicator scores (-1 to +1)
  indicatorScores: {
    rsi: number;
    macd: number;
    vwap: number;
    heikenAshi: number;
    delta: number;
  };

  // Strategy metadata (post Feb-18-2026)
  useMakerOrder?: boolean;   // true = maker (zero fees + rebates), false = taker
  fairValue?: number;        // Our estimated fair value (0–1)
  mispricing?: number;       // fairValue − marketPrice
  takerFee?: number;         // Taker fee as fraction (e.g. 0.0156 = 1.56%)
  secondsToClose?: number;   // Seconds until market closes
  clobTokenIds?: [string, string]; // [upTokenId, downTokenId]
}

export interface MarketData {
  id: string;           // conditionId from Polymarket
  question: string;
  yesPrice: number;     // "Up" outcome price (0–1)
  noPrice: number;      // "Down" outcome price (0–1)
  volume: number;
  liquidity: number;
  expiresAt: Date;
  slug: string;
  clobTokenIds?: [string, string]; // [upTokenId, downTokenId] for CLOB order placement
  acceptingOrders?: boolean;
}

export interface PriceData {
  price: number;
  volume?: number;   // optional — only available from Binance klines
  timestamp: Date;
  source: 'chainlink' | 'binance' | 'polymarket';
}

export interface BotConfig {
  userId: number;
  subscriptionTier: 'free' | 'basic' | 'pro' | 'enterprise';

  // Subscription-based limits
  maxPositionSize: number;
  maxDailyTrades: number;
  maxOpenPositions: number;

  // Strategy settings
  btc15m_enabled: boolean;
  btc15m_edge_threshold: string;    // Minimum net edge to trade (decimal string, e.g. "0.005")
  btc15m_min_probability: string;   // Minimum confidence threshold
  btc15m_early_threshold: string;   // Early window edge threshold
  btc15m_mid_threshold: string;     // Mid window edge threshold
  btc15m_late_threshold: string;    // Late window (T≤10s) edge threshold

  // Risk management
  maxDailyLoss: number;
  targetDailyReturn: number;
  kellyFraction: number;

  // Operation
  runIntervalSeconds: number;
  isActive: boolean;

  // Smart contract
  user_wallet_address: string;
  proxy_contract_address: string | null;
}

export interface BotStatus {
  userId: number;
  status: 'stopped' | 'starting' | 'running' | 'error';
  isActive: boolean;
  lastStartedAt: Date | null;
  lastStoppedAt: Date | null;
  lastCycleAt: Date | null;
  errorMessage: string | null;
  currentBalance: number;
  todayPnl: number;
  todayTrades: number;
}

export interface TradeData {
  userId: number;
  marketId: string;
  marketQuestion: string;
  strategy: 'btc15m' | 'btc15m_up' | 'btc15m_down';
  side: 'yes' | 'no';
  entryPrice: number;
  quantity: number;
  entryValue: number;
  entryTime: Date;
  exitPrice?: number;
  exitValue?: number;
  exitTime?: Date;
  pnl?: number;
  pnlPct?: number;
  status: 'open' | 'closed' | 'cancelled';
  txHash?: string;
}

export interface IndicatorWeights {
  rsi: number;
  macd: number;
  vwap: number;
  heikenAshi: number;
  delta: number;
}

/**
 * Default indicator weights.
 * In the new strategy, momentum (captured via Delta + price history) dominates
 * in the late window. These weights apply to the TA composite score only.
 */
export const DEFAULT_INDICATOR_WEIGHTS: IndicatorWeights = {
  rsi:         0.20,
  macd:        0.25,
  vwap:        0.20,
  heikenAshi:  0.20,
  delta:       0.15,
};