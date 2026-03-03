/**
 * Subscription tier configuration
 */

export const SUBSCRIPTION_TIERS = {
  BASIC: {
    id: 'basic',
    name: 'Basic',
    price: 20,
    priceId: process.env.STRIPE_PRICE_BASIC || '', // Will be set after creating in Stripe
    features: [
      '5 max open positions',
      '$300 max position size',
      'Arbitrage strategy only',
      'Email support',
    ],
    limits: {
      maxPositions: 5,
      maxPositionSize: 300,
      strategies: ['arbitrage'],
    },
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    price: 99,
    priceId: process.env.STRIPE_PRICE_PRO || '',
    features: [
      '15 max open positions',
      '$1,000 max position size',
      'All trading strategies',
      'Priority email support',
      'Advanced analytics',
    ],
    limits: {
      maxPositions: 15,
      maxPositionSize: 1000,
      strategies: ['arbitrage', 'value_betting', 'high_quality'],
    },
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 1999,
    priceId: process.env.STRIPE_PRICE_ENTERPRISE || '',
    features: [
      'Unlimited open positions',
      '$5,000 max position size',
      'All trading strategies',
      '24/7 priority support',
      'Advanced analytics',
      'Custom strategy configuration',
      'Dedicated account manager',
    ],
    limits: {
      maxPositions: 999999, // Effectively unlimited
      maxPositionSize: 5000,
      strategies: ['arbitrage', 'value_betting', 'high_quality'],
    },
  },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

export function getTierLimits(tier: string) {
  const tierUpper = tier.toUpperCase() as SubscriptionTier;
  return SUBSCRIPTION_TIERS[tierUpper]?.limits || SUBSCRIPTION_TIERS.BASIC.limits;
}

export function getTierInfo(tier: string) {
  const tierUpper = tier.toUpperCase() as SubscriptionTier;
  return SUBSCRIPTION_TIERS[tierUpper] || SUBSCRIPTION_TIERS.BASIC;
}