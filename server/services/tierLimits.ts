/**
 * 1. The bot's private key signs CLOB orders directly — no proxy involved.
 * 2. The server controls the signing key, so it can enforce limits before
 *    any order is signed and submitted.
 * 3. On-chain enforcement via the proxy added latency and gas costs with
 *    no security benefit (the server already controls the key).
 *
 * Subscription tiers are still verified on-chain via SubscriptionManager,
 * which is the source of truth for whether a user has paid.
 */

export interface TierLimits {
  /** Human-readable tier name */
  name: string;
  /** Maximum single position size in USDC */
  maxPositionSize: number;
  /** Maximum number of trades per calendar day */
  maxDailyTrades: number;
  /** Maximum number of simultaneously open positions */
  maxOpenPositions: number;
  /** Maximum daily spend in USDC (sum of all entries) */
  maxDailySpend: number;
  /** Kelly fraction — how aggressively to size positions (0–1) */
  kellyFraction: number;
  /** Minimum edge threshold before placing any order */
  minEdgeThreshold: number;
  /** Whether maker orders are enabled for this tier */
  makerOrdersEnabled: boolean;
  /** Whether late-window (T≤10s) taker orders are enabled */
  takerOrdersEnabled: boolean;
}

/**
 * Tier definitions.
 * These mirror what the SubscriptionManager contract enforces on-chain for
 * payment, but the trading limits are now purely app-side.
 *
 * Tier 0 = none (no subscription)
 * Tier 1 = basic
 * Tier 2 = pro
 * Tier 3 = enterprise / premium
 */
export const TIER_LIMITS: Record<string, TierLimits> = {
  none: {
    name:               'None',
    maxPositionSize:    0,
    maxDailyTrades:     0,
    maxOpenPositions:   0,
    maxDailySpend:      0,
    kellyFraction:      0,
    minEdgeThreshold:   1,   // Effectively disabled
    makerOrdersEnabled: false,
    takerOrdersEnabled: false,
  },
  basic: {
    name:               'Basic',
    maxPositionSize:    50,   // $50 max per trade
    maxDailyTrades:     10,
    maxOpenPositions:   3,
    maxDailySpend:      200,  // $200/day
    kellyFraction:      0.15, // Conservative — 15% of full Kelly
    minEdgeThreshold:   0.01, // 1% minimum edge
    makerOrdersEnabled: true,
    takerOrdersEnabled: false, // Taker orders disabled on basic (fees eat margin)
  },
  pro: {
    name:               'Pro',
    maxPositionSize:    250,  // $250 max per trade
    maxDailyTrades:     50,
    maxOpenPositions:   10,
    maxDailySpend:      1000, // $1,000/day
    kellyFraction:      0.25, // 25% of full Kelly
    minEdgeThreshold:   0.005, // 0.5% minimum edge
    makerOrdersEnabled: true,
    takerOrdersEnabled: true,  // T-10s taker orders enabled
  },
  enterprise: {
    name:               'Enterprise',
    maxPositionSize:    2000, // $2,000 max per trade
    maxDailyTrades:     999,
    maxOpenPositions:   50,
    maxDailySpend:      10000, // $10,000/day
    kellyFraction:      0.33,  // 33% of full Kelly
    minEdgeThreshold:   0.003, // 0.3% minimum edge
    makerOrdersEnabled: true,
    takerOrdersEnabled: true,
  },
};

/**
 * Get tier limits for a subscription tier string.
 * Falls back to 'none' if the tier is unrecognised.
 */
export function getTierLimits(tier: string): TierLimits {
  return TIER_LIMITS[tier] ?? TIER_LIMITS.none;
}

/**
 * Map numeric tier (from SubscriptionManager contract) to string key.
 * Tier 0=none, 1=basic, 2=pro, 3=enterprise
 */
export function numericTierToString(tier: number): string {
  const map: Record<number, string> = { 0: 'none', 1: 'basic', 2: 'pro', 3: 'enterprise' };
  return map[tier] ?? 'none';
}

/**
 * Validate a proposed trade against tier limits.
 * Returns null if valid, or an error message string if blocked.
 */
export function validateTrade(params: {
  tier:             string;
  positionSize:     number;
  todayTradeCount:  number;
  todaySpend:       number;
  openPositions:    number;
  isTakerOrder:     boolean;
  netEdge:          number;
}): string | null {
  const limits = getTierLimits(params.tier);

  if (limits.maxDailyTrades === 0) {
    return `No active subscription. Please subscribe to start trading.`;
  }
  if (params.positionSize > limits.maxPositionSize) {
    return `Position size $${params.positionSize.toFixed(2)} exceeds tier limit $${limits.maxPositionSize} (${limits.name})`;
  }
  if (params.todayTradeCount >= limits.maxDailyTrades) {
    return `Daily trade limit reached: ${params.todayTradeCount}/${limits.maxDailyTrades} (${limits.name})`;
  }
  if (params.todaySpend + params.positionSize > limits.maxDailySpend) {
    return `Daily spend limit would be exceeded: $${(params.todaySpend + params.positionSize).toFixed(2)} > $${limits.maxDailySpend} (${limits.name})`;
  }
  if (params.openPositions >= limits.maxOpenPositions) {
    return `Max open positions reached: ${params.openPositions}/${limits.maxOpenPositions} (${limits.name})`;
  }
  if (params.isTakerOrder && !limits.takerOrdersEnabled) {
    return `Taker orders not available on ${limits.name} plan. Upgrade to Pro or higher.`;
  }
  if (params.netEdge < limits.minEdgeThreshold) {
    return `Edge ${(params.netEdge * 100).toFixed(3)}% below minimum ${(limits.minEdgeThreshold * 100).toFixed(3)}% for ${limits.name} tier`;
  }

  return null; // Valid
}