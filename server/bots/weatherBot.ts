import { KalshiClient, KalshiMarket } from "../services/kalshiClient";
import { NwsService, NwsForecast, CITIES } from "../services/nwsService";
import { getEnsembleForecast } from "../services/openMeteoService";
import * as db from "../db";
import { nanoid } from "nanoid";

// ─── Math Helpers ──────────────────────────────────────────────────────────────

function normCdf(x: number, mean: number, std: number): number {
  const z = (x - mean) / std;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 +
      t * (-0.356563782 +
        t * (1.781477937 +
          t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

function probForStrike(
  forecast: number,
  sigma: number,
  floor: number | null,
  cap: number | null,
  type: string
): number {
  if (type === "greater" && floor !== null) return 1 - normCdf(floor, forecast, sigma);
  if (type === "less"    && cap  !== null) return normCdf(cap, forecast, sigma);
  if (floor !== null && cap !== null)      return normCdf(cap, forecast, sigma) - normCdf(floor, forecast, sigma);
  return 0.5;
}

// Kalshi fee: 7% of winnings (gross profit) for taker orders
const KALSHI_FEE_RATE = 0.07;

// ─── Safety Guardrails ────────────────────────────────────────────────────────
//
// NEVER trade contracts priced below this threshold.
// Sim4 proof: ALL 12 bets at ≤18¢ lost (0% win rate, -$161 P&L).
// ALL 5 bets at 15-19¢ also lost. Raising from 15¢ → 20¢ would have
// blocked all 12 sub-20¢ losses while keeping every win (lowest win was @22¢).
// At <20¢ a 3°F forecast error (within 1σ for most cities) completely wipes edge.
const MIN_PRICE_CENTS = 20;
//
// For BETWEEN-NO bets specifically: require NO ≥ this price.
// When market prices YES > 50¢ (NO < 50¢), market consensus says temp WILL land
// in that 1°F range. Sim4: between-NO at NO < 50¢ → 31% win rate (4W/9L).
// Between-NO at NO ≥ 50¢ → 50% win rate. Combined with distance guard → 80%+.
const MIN_BETWEEN_NO_PRICE_CENTS = 50;
//
// For BETWEEN-NO bets: range midpoint must be at least this many σ from forecast.
// A 1°F range within 1.5σ of our forecast has meaningful probability of being hit
// by any reasonable forecast error. Sim4: all remaining between-NO losses at 50-55¢
// had range within ~1.2σ of blended forecast. Wins had range ≥1.5σ away.
const MIN_BETWEEN_NO_SIGMA_DIST = 1.5;
//
// NEVER trade a market closing within this many minutes.
const MIN_MINUTES_TO_CLOSE = 60;
//
// Hard cap on entry price.
// Raised 55¢ → 60¢ (2026-03-25, sim 5 start).
// The MIN_EV_CENTS_LOCKED=10¢ filter acts as a natural secondary gate:
//   at 60¢, EV≥10¢ requires ourProb≥72% (vs 67% required at 55¢).
// So only high-conviction signals pass at 60¢ — the EV filter self-polices the expansion.
// Breakeven actual WR at 60¢ = 61.7%. Requires sim 5 validated WR ≥ 62% to be profitable.
// If sim 5 WR falls below 62%, revert to 55¢.
const MAX_PRICE_CENTS_HARD_CAP = 60;
//
// Minimum win probability required to place any trade.
// Uses city.sigma (NWS forecast accuracy) for probability calculations — NOT
// sigmaMkt (market-implied vol which is 70% wider and inflates deep-OTM probabilities).
// 70% model conviction ≈ 59-62% real win rate (model is overconfident by ~10%).
const MIN_CONVICTION = 0.70;
//
// Minimum model edge over market-implied probability.
// Raised from 0.03 → 0.05: weather markets reprice 2-5% daily as new NWS
// updates propagate. A 3% edge is indistinguishable from daily repricing noise.
// 5% edge requires a meaningful forecast difference to enter — real signal only.
const MIN_EDGE = 0.05;
//
// Locked EV threshold — not user-editable to prevent under-filtering.
// Raised from 6¢ → 10¢: ensures the trade has meaningful expected profit.
// At 70% conviction and 55¢ cap: EV = 0.70*45*0.93 - 0.30*55 = 12.7¢ — passes.
// At 70% conviction and 60¢:     EV = 0.70*40*0.93 - 0.30*60 = 8.0¢  — marginal.
// The 10¢ bar naturally rejects marginal entries near the price cap.
const MIN_EV_CENTS_LOCKED = 10;
//
// Minimum open interest — lowered from 200 → 100 to surface more cheap contracts
// (the 21-55¢ range has lower OI than expensive markets). Still filters dead markets.
const MIN_LIQUIDITY_LOCKED = 100;

/**
 * Expected value in cents for buying one contract at priceCents.
 * Win: profit = (100 - priceCents) * (1 - KALSHI_FEE_RATE)
 * Loss: loss  = priceCents
 */
function calcEV(ourProb: number, priceCents: number): number {
  const grossProfit = 100 - priceCents;
  const netProfit   = grossProfit * (1 - KALSHI_FEE_RATE);
  return ourProb * netProfit - (1 - ourProb) * priceCents;
}

/**
 * Parse the settlement date (YYYY-MM-DD) from a Kalshi ticker.
 * Kalshi format: SERIES-YYMONDD-STRIKE  (e.g. KXHIGHCHI-26MAR25-T73)
 * YYMONDD: YY = 2-digit year (20YY), MON = 3-letter month, DD = 2-digit day.
 * Returns null if the ticker doesn't match the expected pattern.
 */
function parseDateFromTicker(ticker: string): string | null {
  const MONTH_MAP: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  // Match the YYMONDD segment anywhere in the ticker
  const m = ticker.toUpperCase().match(/-(\d{2})([A-Z]{3})(\d{2})(?:-|$)/);
  if (!m) return null;
  const year  = 2000 + parseInt(m[1], 10);
  const month = MONTH_MAP[m[2]];
  const day   = m[3].padStart(2, "0");
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

/** Returns minutes until the market closes. Returns Infinity if no close_time. */
function minutesToClose(market: KalshiMarket): number {
  if (!market.close_time) return Infinity;
  return (new Date(market.close_time).getTime() - Date.now()) / 60000;
}

/**
 * Returns a confidence score (0-1) for how good this signal is.
 * Used to rank signals when we have budget constraints.
 * Factors: EV, edge size (ourProb - marketProb), forecast freshness, distance from 50¢
 */
function signalConfidence(
  ourProb: number,
  marketProb: number,
  ev: number,
  forecastAgeMinutes: number
): number {
  const edge      = Math.abs(ourProb - marketProb);
  const freshness = forecastAgeMinutes >= 0
    ? Math.max(0, 1 - forecastAgeMinutes / 360)   // decays to 0 after 6h
    : 0.5;                                          // unknown age → neutral
  // Penalty for being too far from 50 (thin markets on extreme strikes)
  const extremePenalty = marketProb < 0.1 || marketProb > 0.9 ? 0.5 : 1.0;
  return (ev / 20) * edge * freshness * extremePenalty; // normalised heuristic
}

// ─── Time-Aware NWS Update Window Scheduler ───────────────────────────────────
//
// NWS issues forecast updates at approximately 06:00, 12:00, 18:00, 00:00 local.
// Highest-edge window: 45 minutes immediately after each update.
// Outside those windows the market has already repriced and edge shrinks.
//
const NWS_UPDATE_HOURS_LOCAL    = [6, 12, 18, 0];
const HIGH_FREQ_WINDOW_MINUTES  = 45;
const HIGH_FREQ_INTERVAL_MS     = 2  * 60 * 1000;   // 2 min
const LOW_FREQ_INTERVAL_MS      = 30 * 60 * 1000;   // 30 min

function isInHighFreqWindow(enabledCities: string[]): boolean {
  const now = new Date();
  for (const cityCode of enabledCities) {
    const tz = CITIES[cityCode]?.timezone ?? "America/New_York";
    const localStr = now.toLocaleString("en-US", {
      timeZone: tz, hour: "numeric", minute: "numeric", hour12: false,
    });
    const [hourStr, minStr] = localStr.split(":");
    const localHour = parseInt(hourStr, 10);
    const localMin  = parseInt(minStr, 10);

    for (const updateHour of NWS_UPDATE_HOURS_LOCAL) {
      let minutesSinceUpdate: number;
      if (localHour === updateHour) {
        minutesSinceUpdate = localMin;
      } else if (localHour === (updateHour + 1) % 24 && localMin < HIGH_FREQ_WINDOW_MINUTES) {
        minutesSinceUpdate = 60 + localMin;
      } else {
        continue;
      }
      if (minutesSinceUpdate <= HIGH_FREQ_WINDOW_MINUTES) return true;
    }
  }
  return false;
}

function minutesUntilNextWindow(enabledCities: string[]): number {
  const now = new Date();
  let minWait = Infinity;
  for (const cityCode of enabledCities) {
    const tz = CITIES[cityCode]?.timezone ?? "America/New_York";
    const localStr = now.toLocaleString("en-US", {
      timeZone: tz, hour: "numeric", minute: "numeric", hour12: false,
    });
    const [hourStr, minStr] = localStr.split(":");
    const localHour = parseInt(hourStr, 10);
    const localMin  = parseInt(minStr, 10);
    const totalMinutes = localHour * 60 + localMin;

    for (const updateHour of NWS_UPDATE_HOURS_LOCAL) {
      let diff = updateHour * 60 - totalMinutes;
      if (diff < 0) diff += 24 * 60;
      if (diff < minWait) minWait = diff;
    }
  }
  return minWait === Infinity ? 360 : minWait;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface TradeSignal {
  cityCode: string;
  cityName: string;
  ticker: string;
  side: "yes" | "no";
  priceCents: number;
  ourProb: number;
  marketProb: number;
  ev: number;
  confidence: number;
  contracts: number;
  forecastTemp: number;
  hourlyHighTemp: number | null;
  strikeDesc: string;
  strikeType: string;
  forecastAgeMinutes: number;
  windowType: "high-freq" | "low-freq";
}

export interface BotConfig {
  userId: number;
  flatBetDollars: number;
  minEvCents: number;
  maxPriceCents: number;
  minLiquidity: number;
  enabledCities: string[];
  dryRun: boolean;
  maxDailyTrades: number;
}

// ─── WeatherBot ────────────────────────────────────────────────────────────────

export class WeatherBot {
  private kalshi: KalshiClient;
  private nws: NwsService;
  private config: BotConfig;
  private running = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private lastScanAt: Date | null = null;
  private tradesThisSession = 0;
  private errorsThisSession = 0;
  private lastSignals: TradeSignal[] = [];
  private currentMode: "high-freq" | "low-freq" | "idle" = "idle";

  // Track open positions to avoid doubling up on the same exact contract
  private openPositionTickers: Set<string> = new Set();
  // Track daily trades to enforce limits
  private dailyTradeCount = 0;
  private dailyTradeDate = "";

  constructor(kalshi: KalshiClient, nws: NwsService, config: BotConfig) {
    this.kalshi = kalshi;
    this.nws = nws;
    this.config = config;
  }

  isRunning() { return this.running; }

  getStatus() {
    return {
      running: this.running,
      lastScanAt: this.lastScanAt,
      tradesThisSession: this.tradesThisSession,
      errorsThisSession: this.errorsThisSession,
      lastSignals: this.lastSignals,
      enabledCities: this.config.enabledCities,
      dryRun: this.config.dryRun,
      scanMode: this.currentMode,
      dailyTradeCount: this.dailyTradeCount,
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`[WeatherBot] Starting for user ${this.config.userId} — time-aware scheduler active${this.config.dryRun ? " | *** PAPER TRADING MODE — no real orders will be placed ***" : " | LIVE TRADING"}`);
    await this.log("info", "Bot started with time-aware NWS window scheduler");
    // Prefetch open positions so we don't double up on session start
    await this.refreshOpenPositions();
    await this.scan();
    this.scheduleNext();
  }

  async stop() {
    this.running = false;
    if (this.scanTimer) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.currentMode = "idle";
    console.log(`[WeatherBot] Stopped for user ${this.config.userId}`);
    await this.log("info", "Bot stopped");
  }

  private scheduleNext() {
    if (!this.running) return;
    if (this.scanTimer) clearTimeout(this.scanTimer);

    const inWindow = isInHighFreqWindow(this.config.enabledCities);
    const interval = inWindow ? HIGH_FREQ_INTERVAL_MS : LOW_FREQ_INTERVAL_MS;

    if (inWindow && this.currentMode !== "high-freq") {
      console.log(`[WeatherBot] Entering HIGH-FREQUENCY scan mode — NWS update window active`);
      this.log("info", "Entering high-frequency scan mode — NWS update window active");
    } else if (!inWindow && this.currentMode !== "low-freq") {
      const wait = minutesUntilNextWindow(this.config.enabledCities);
      console.log(`[WeatherBot] Entering LOW-FREQUENCY scan mode — next NWS window in ~${wait} min`);
      this.log("info", `Low-frequency mode — next NWS update window in ~${wait} minutes`);
    }

    this.currentMode = inWindow ? "high-freq" : "low-freq";

    this.scanTimer = setTimeout(async () => {
      await this.scan();
      this.scheduleNext();
    }, interval);
  }

  /**
   * Fetch current open positions from Kalshi to populate openPositionTickers.
   * This prevents the bot from re-entering a market it already holds.
   */
  private async refreshOpenPositions(): Promise<void> {
    // IMPORTANT: Only clear the set AFTER a successful fetch.
    // Clearing before a try/catch means a DB failure leaves an empty set,
    // causing the bot to re-enter every position it already holds.

    if (this.config.dryRun) {
      try {
        const openPaperTrades = await db.getOpenTrades(this.config.userId, true);
        this.openPositionTickers.clear();
        for (const trade of openPaperTrades) {
          if (trade.marketTicker) this.openPositionTickers.add(trade.marketTicker);
        }
        if (this.openPositionTickers.size > 0) {
          console.log(`[WeatherBot] [PAPER] ${this.openPositionTickers.size} open paper position(s) loaded from DB — will skip these`);
        }
      } catch (err: any) {
        console.warn(`[WeatherBot] Could not load open paper positions from DB: ${err.message} — retaining previous position set to avoid re-entry`);
      }
    } else {
      try {
        const openDbTrades = await db.getOpenTrades(this.config.userId, false);
        this.openPositionTickers.clear();
        for (const trade of openDbTrades) {
          if (trade.marketTicker) this.openPositionTickers.add(trade.marketTicker);
        }
      } catch (_) {
        console.warn(`[WeatherBot] Could not load open live positions from DB — retaining previous position set`);
      }

      try {
        const result = await this.kalshi.getPositions();
        for (const pos of result.market_positions ?? []) {
          if ((pos.position ?? 0) !== 0) {
            this.openPositionTickers.add(pos.ticker);
          }
        }
        if (this.openPositionTickers.size > 0) {
          console.log(`[WeatherBot] ${this.openPositionTickers.size} open position(s) found — will skip these`);
        }
      } catch (err: any) {
        console.warn(`[WeatherBot] Could not refresh open positions from Kalshi: ${err.message}`);
      }
    }
  }

  /**
   * Check and reset daily trade count if it's a new day.
   */
  private checkDailyReset(): void {
    const today = new Date().toISOString().split("T")[0];
    if (today !== this.dailyTradeDate) {
      this.dailyTradeDate = today;
      this.dailyTradeCount = 0;
    }
  }

  async scan(): Promise<TradeSignal[]> {
    this.lastScanAt = new Date();
    const signals: TradeSignal[] = [];
    const inWindow = isInHighFreqWindow(this.config.enabledCities);
    const windowType: "high-freq" | "low-freq" = inWindow ? "high-freq" : "low-freq";

    console.log(
      `[WeatherBot] Scan params — ` +
      `prob_sigma: city.sigma (NWS accuracy) | ` +
      `MIN_PRICE: ${MIN_PRICE_CENTS}¢ | MIN_BETWEEN_NO_PRICE: ${MIN_BETWEEN_NO_PRICE_CENTS}¢ | ` +
      `MIN_BETWEEN_SIGMA_DIST: ${MIN_BETWEEN_NO_SIGMA_DIST}σ | MIN_CONVICTION: ${(MIN_CONVICTION * 100).toFixed(0)}% | ` +
      `MIN_EDGE: ${(MIN_EDGE * 100).toFixed(0)}% | MIN_EV: ${MIN_EV_CENTS_LOCKED}¢ | ` +
      `MAX_PRICE: ${MAX_PRICE_CENTS_HARD_CAP}¢ | MAX_STRIKE_SIGMA: 1.0σ`
    );
    await this.log(
      "info",
      `Scan params — MIN_PRICE: ${MIN_PRICE_CENTS}¢ | MIN_BETWEEN_NO_PRICE: ${MIN_BETWEEN_NO_PRICE_CENTS}¢ | ` +
      `MIN_BETWEEN_SIGMA_DIST: ${MIN_BETWEEN_NO_SIGMA_DIST}σ | MIN_CONVICTION: ${(MIN_CONVICTION * 100).toFixed(0)}% | ` +
      `MIN_EDGE: ${(MIN_EDGE * 100).toFixed(0)}% | MIN_EV: ${MIN_EV_CENTS_LOCKED}¢ | MAX_PRICE: ${MAX_PRICE_CENTS_HARD_CAP}¢`
    );

    this.checkDailyReset();

    try {
      // 1. Fetch all NWS forecasts in parallel
      const forecasts = await this.nws.getAllForecasts();
      const forecastMap = new Map(forecasts.map((f) => [f.cityCode, f]));

      // Persist forecasts to DB (Forecasts page display)
      await Promise.allSettled(
        forecasts.map((f) => {
          const cityDef = CITIES[f.cityCode];
          return db.upsertForecast({
            cityCode: f.cityCode,
            cityName: f.cityName,
            forecastHigh: f.highTemp,
            lowTemp: f.lowTemp,
            sigma: cityDef?.sigma ?? 3.0,
            shortForecast: f.shortForecast,
            detailedForecast: f.detailedForecast,
            windSpeed: f.windSpeed,
            windDirection: f.windDirection,
            precipChance: f.precipChance,
            forecastDate: f.forecastDate,
            tomorrowHigh: f.tomorrowHighTemp,
            tomorrowForecastDate: f.tomorrowForecastDate,
          });
        })
      );

      // 2. Refresh open positions before trading
      await this.refreshOpenPositions();

      // 3. Analyze each enabled city
      for (const cityCode of this.config.enabledCities) {
        const city = CITIES[cityCode];
        if (!city) {
          console.warn(`[WeatherBot] Unknown city code: ${cityCode} — skipping`);
          continue;
        }
        const forecast = forecastMap.get(cityCode);
        if (!forecast) {
          console.warn(`[WeatherBot] No NWS forecast for ${cityCode} — skipping`);
          continue;
        }

        try {
          const citySignals = await this.analyzeCity(city, forecast, windowType);
          signals.push(...citySignals);
        } catch (err: any) {
          console.error(`[WeatherBot] Error analyzing ${cityCode}:`, err.message);
          this.errorsThisSession++;
        }
      }

      // 4. Sort by confidence descending (EV * edge * freshness)
      signals.sort((a, b) => b.confidence - a.confidence);
      this.lastSignals = signals;

      const modeTag = this.config.dryRun ? "[PAPER]" : "[LIVE]";
      if (signals.length > 0) {
        const top = signals[0];
        console.log(
          `[WeatherBot] ${modeTag} Scan [${windowType}] — ${signals.length} signal(s) | ` +
          `top: ${top.cityName} ${top.side.toUpperCase()} ${top.strikeDesc} ` +
          `@ ${top.priceCents}¢ | EV: +${top.ev.toFixed(1)}¢ | edge: ${((top.ourProb - top.marketProb) * 100).toFixed(1)}%`
        );
        await this.log(
          "signal",
          `${modeTag} Scan [${windowType}]: ${signals.length} signal(s) — top: ${top.cityName} ` +
          `${top.side.toUpperCase()} ${top.strikeDesc} @ ${top.priceCents}¢ | ` +
          `ourProb: ${(top.ourProb * 100).toFixed(1)}% | mktProb: ${(top.marketProb * 100).toFixed(1)}% | ` +
          `EV: +${top.ev.toFixed(1)}¢ | forecast: ${top.forecastTemp}°F (age: ${top.forecastAgeMinutes}min)`
        );
      } else {
        console.log(`[WeatherBot] ${modeTag} Scan [${windowType}] — no signals above threshold`);
        await this.log("info", `${modeTag} Scan [${windowType}] — no signals above threshold`);
      }

      // 5. Execute signals
      if (!this.config.dryRun && signals.length > 0) {
        const maxTrades = inWindow ? 5 : 2;
        let spentCents = 0;
        const balanceData = await this.kalshi.getBalance();
        const availableBalanceCents = balanceData.balance;

        for (const signal of signals.slice(0, maxTrades)) {
          // Cost of this trade in cents: contracts × price_per_contract
          const tradeCostCents = signal.contracts * signal.priceCents;
          const remainingBalance = availableBalanceCents - spentCents;

          if (tradeCostCents > remainingBalance) {
            console.log(`[WeatherBot] Skipping ${signal.cityName} ${signal.side.toUpperCase()} — cost $${(tradeCostCents/100).toFixed(2)} exceeds remaining balance $${(remainingBalance/100).toFixed(2)}`);
            await this.log("info", `Skipped ${signal.cityName} ${signal.side.toUpperCase()} ${signal.strikeDesc}: cost $${(tradeCostCents/100).toFixed(2)} > balance $${(remainingBalance/100).toFixed(2)}`);
            continue;
          }

          await this.executeTrade(signal);
          spentCents += tradeCostCents;
        }

        if (spentCents > 0) {
          console.log(`[WeatherBot] Session spent: $${(spentCents/100).toFixed(2)} of $${(availableBalanceCents/100).toFixed(2)} available`);
        }
      } else if (this.config.dryRun && signals.length > 0) {
        const maxDaily = this.config.maxDailyTrades ?? 20;
        const maxTrades = inWindow ? 5 : 2;
        for (const signal of signals.slice(0, maxTrades)) {
          if (this.dailyTradeCount >= maxDaily) {
            console.log(`[WeatherBot] [PAPER] Daily trade limit (${maxDaily}) reached — skipping ${signal.ticker}`);
            break;
          }
          await db.insertTrade({
            userId: this.config.userId,
            kalshiOrderId: null,
            marketTicker: signal.ticker,
            cityCode: signal.cityCode,
            cityName: signal.cityName,
            strikeDesc: signal.strikeDesc,
            side: signal.side,
            priceCents: signal.priceCents,
            contracts: signal.contracts,
            status: "filled",
            won: null,
            pnl: null,
            feeCents: null,
            settledAt: null,
            isPaper: true,
            evCents: signal.ev,
            ourProb: signal.ourProb,
          });
          this.dailyTradeCount++;
          // Mark ticker as held so we don't re-enter this market in future scans
          this.openPositionTickers.add(signal.ticker);
          const paperMsg = `[PAPER] Trade recorded: ${signal.cityName} ${signal.side.toUpperCase()} ${signal.strikeDesc} @ ${signal.priceCents}¢ x${signal.contracts} | EV: +${signal.ev.toFixed(1)}¢ | edge: ${((signal.ourProb - signal.marketProb) * 100).toFixed(1)}% | forecast: ${signal.forecastTemp}°F`;
          console.log(`[WeatherBot] ${paperMsg}`);
          await this.log("trade", paperMsg);
        }
      }

      await db.upsertBotStatus({
        userId: this.config.userId,
        status: "running",
        lastScanAt: this.lastScanAt,
        signalsFound: signals.length,
        errorMessage: null,
      });

    } catch (err: any) {
      console.error(`[WeatherBot] Scan error:`, err.message);
      this.errorsThisSession++;
      await this.log("error", `Scan error: ${err.message}`);
      await db.upsertBotStatus({
        userId: this.config.userId,
        status: "error",
        errorMessage: err.message,
      });
    }

    return signals;
  }

  private async analyzeCity(
    city: (typeof CITIES)[string],
    forecast: NwsForecast,
    windowType: "high-freq" | "low-freq"
  ): Promise<TradeSignal[]> {
    const signals: TradeSignal[] = [];

    // Locked EV bar — not user-configurable to prevent under-filtering.
    const evThreshold = MIN_EV_CENTS_LOCKED;

    // Use hourly high if available (more accurate), else daily period high
    const nwsTemp = forecast.hourlyHighTemp ?? forecast.highTemp;

    // ── Multi-model ensemble (Open-Meteo: ECMWF + GFS + best_match) ──────────
    // Fetch in parallel with market data; degrade gracefully if unavailable.
    const [ensembleResult, tomorrowEnsembleResult, marketsResult] = await Promise.allSettled([
      getEnsembleForecast(city.lat, city.lon, forecast.forecastDate, city.timezone),
      forecast.tomorrowHighTemp != null
        ? getEnsembleForecast(city.lat, city.lon, forecast.tomorrowForecastDate, city.timezone)
        : Promise.resolve(null),
      this.kalshi.getMarkets({ series_ticker: city.seriesTicker, status: "open", limit: 20 }),
    ]);

    const ensemble         = ensembleResult.status         === "fulfilled" ? ensembleResult.value         : null;
    const tomorrowEnsemble = tomorrowEnsembleResult.status === "fulfilled" ? tomorrowEnsembleResult.value : null;
    const markets          = marketsResult.status          === "fulfilled" ? marketsResult.value.markets  : [];

    if (marketsResult.status === "rejected") {
      console.warn(`[WeatherBot] Failed to fetch markets for ${city.code}: ${(marketsResult.reason as any)?.message}`);
    }

    // Model spread guard: if ECMWF and GFS disagree strongly, skip this city today.
    // A spread > 6°F means the atmosphere is chaotic and neither model is reliable.
    if (ensemble && ensemble.modelCount >= 2 && ensemble.spread > 6) {
      console.log(`[WeatherBot] ${city.code} — ensemble spread ${ensemble.spread}°F > 6°F, models disagree — skipping`);
      await this.log("warning", `${city.name} — ensemble spread ${ensemble.spread.toFixed(1)}°F > 6°F, models disagree — skipping city this scan`);
      return signals;
    }

    if (markets.length === 0) {
      console.warn(`[WeatherBot] ${city.code} — no open markets found (series: ${city.seriesTicker})`);
      return signals;
    }

    // Blending, bias, and regime are computed per-market inside the loop
    // so that today's and tomorrow's markets each use the correct forecast date.
    const currentMonth = new Date().getMonth();
    const monthlyNormal = city.monthlyNormals[currentMonth];

    const effectiveEvThreshold = evThreshold;
    const effectiveMaxPrice = MAX_PRICE_CENTS_HARD_CAP;
    const minWinProfit = this.config.flatBetDollars * 0.10;

    console.log(`[WeatherBot] ${city.code} — ${markets.length} markets | NWS today ${nwsTemp}°F${forecast.tomorrowHighTemp != null ? ` / tomorrow ${forecast.tomorrowHighTemp}°F` : ""} | bias ${city.directionBias > 0 ? "+" : ""}${city.directionBias}°F | σ=${city.sigma}°F`);

    for (const market of markets) {
      const floor      = market.floor_strike ?? null;
      const cap        = market.cap_strike ?? null;
      const strikeType = market.strike_type ?? "between";
      const strikeLabel = this.strikeDesc(floor, cap, strikeType);
      const oi  = market.open_interest ?? 0;
      const vol = market.volume ?? 0;
      const liquidity = oi > 0 ? oi : vol;

      if (!["greater", "less", "between"].includes(strikeType)) continue;

      // ── Per-market forecast date alignment ────────────────────────────────
      // Determine which calendar date this market settles on.
      // IMPORTANT: Do NOT use close_time for this. Kalshi close_time can fall
      // after midnight UTC (e.g. 06:00 UTC = 1 AM CDT) while the market still
      // measures TODAY's temperature. close_time → local date would then return
      // tomorrow's date, causing the bot to use tomorrow's forecast for today's
      // market (e.g. 79°F instead of 71°F → fake 76% ourProb on a losing trade).
      //
      // Instead: parse the settlement date directly from the ticker.
      // Kalshi ticker format: SERIES-YYMONDD-STRIKE (e.g. KXHIGHCHI-26MAR25-T73)
      // YYMONDD: YY=2-digit year, MON=3-letter month, DD=2-digit day
      const settlementDate = parseDateFromTicker(market.ticker) ?? forecast.forecastDate;
      const isToday    = settlementDate === forecast.forecastDate;
      const isTomorrow = settlementDate === forecast.tomorrowForecastDate;
      if (!isToday && !isTomorrow) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: settles ${settlementDate}, no forecast available`);
        continue;
      }
      // Skip tomorrow markets when NWS hasn't published a tomorrow forecast yet.
      // Using today's temp for a tomorrow market causes 10°F+ errors in spring/fall transition.
      if (isTomorrow && forecast.tomorrowHighTemp == null) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: tomorrow market but no NWS tomorrow forecast yet`);
        continue;
      }
      const marketNwsRaw = isToday ? nwsTemp : forecast.tomorrowHighTemp!;
      const marketEns    = isToday ? ensemble : tomorrowEnsemble;
      let marketForecastTemp: number;
      if (marketEns && marketEns.modelCount >= 2) {
        marketForecastTemp = marketNwsRaw * 0.40 + marketEns.consensus * 0.60;
      } else {
        marketForecastTemp = marketNwsRaw;
      }
      const marketBiasedForecast = marketForecastTemp + city.directionBias;
      const marketRegimeDelta    = marketBiasedForecast - monthlyNormal;
      const marketRegime: "cold" | "warm" | "neutral" =
        marketRegimeDelta < -8 ? "cold" : marketRegimeDelta > 8 ? "warm" : "neutral";
      // ─────────────────────────────────────────────────────────────────────

      // ── Strike distance guard ──
      // Skip markets where the strike is too far from our blended forecast.
      // Deep OTM contracts have huge probability sensitivity to forecast error —
      // a 2°F model miss on a 1.5σ-away strike can flip our edge from positive to negative.
      // Root cause of the BOS >51°F (1.21σ) and DC >56°F (1.21σ) bad trades.
      const MAX_STRIKE_SIGMA = 1.0; // skip if strike more than 1 sigma from forecast
      let strikeDistance = 0;
      if (strikeType === "greater" && floor !== null) {
        strikeDistance = (floor - marketBiasedForecast) / city.sigma;
      } else if (strikeType === "less" && cap !== null) {
        strikeDistance = (marketBiasedForecast - cap) / city.sigma;
      }
      if (strikeDistance > MAX_STRIKE_SIGMA) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: strike ${strikeDistance.toFixed(2)}σ from forecast (max ${MAX_STRIKE_SIGMA}σ)`);
        continue;
      }

      // ── Between-NO distance guard ──
      // For "between" markets, only bet NO when the range midpoint is clearly
      // far from our forecast. A 1°F range within 1.5σ of forecast has real
      // probability of being hit by any routine model error.
      // Sim4: all between-NO losses at 50-55¢ NO had range within ~1.2σ of forecast;
      // winning between-NO bets had range ≥1.5σ away.
      if (strikeType === "between" && floor !== null && cap !== null) {
        const rangeMidpoint = (floor + cap) / 2;
        const betweenDist = Math.abs(marketBiasedForecast - rangeMidpoint) / city.sigma;
        if (betweenDist < MIN_BETWEEN_NO_SIGMA_DIST) {
          console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: between range ${betweenDist.toFixed(2)}σ from forecast (min ${MIN_BETWEEN_NO_SIGMA_DIST}σ)`);
          continue;
        }
      }

      // ── Pre-probability guards ──
      if (liquidity > 0 && liquidity < MIN_LIQUIDITY_LOCKED) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: low liquidity ${liquidity} < ${MIN_LIQUIDITY_LOCKED}`);
        continue;
      }
      const minsLeft = minutesToClose(market);
      if (minsLeft < MIN_MINUTES_TO_CLOSE) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: closes in ${minsLeft.toFixed(0)}min`);
        continue;
      }
      if (this.openPositionTickers.has(market.ticker)) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: already held`);
        continue;
      }
      if (strikeType === "between" && city.sigmaMkt > 5.0 && windowType === "low-freq") continue;

      // Use city.sigma (actual NWS forecast accuracy) — NOT sigmaMkt (market-implied vol).
      // sigmaMkt is ~70% wider than sigma; using it inflates deep-OTM probabilities by 2x,
      // creating fake edges on cheap contracts (e.g., 24% vs true ~11% for BOS >51°F @ 5¢).
      const ourProb = probForStrike(marketBiasedForecast, city.sigma, floor, cap, strikeType);

      // ── YES side ──
      const yesAsk        = market.yes_ask;
      const yesIsWarmBet  = strikeType === "greater";
      const yesRegimeOk   = !(marketRegime === "cold" && yesIsWarmBet) && !(marketRegime === "warm" && !yesIsWarmBet && strikeType === "less");
      const yesMarketProb = yesAsk / 100;
      const yesEdge       = ourProb - yesMarketProb;
      const yesEV         = calcEV(ourProb, yesAsk);

      {
        const reasons: string[] = [];
        if (ourProb < MIN_CONVICTION)          reasons.push(`conv ${(ourProb*100).toFixed(0)}%<${(MIN_CONVICTION*100).toFixed(0)}%`);
        if (yesEdge < MIN_EDGE)                reasons.push(`edge ${(yesEdge*100).toFixed(1)}%<${(MIN_EDGE*100).toFixed(0)}%`);
        if (!yesRegimeOk)                      reasons.push(`regime(${marketRegime})`);
        if (yesAsk < MIN_PRICE_CENTS)          reasons.push(`price ${yesAsk}¢<min`);
        if (yesAsk > effectiveMaxPrice)        reasons.push(`price ${yesAsk}¢>cap`);
        if (reasons.length === 0 && yesEV < effectiveEvThreshold) reasons.push(`EV ${yesEV.toFixed(1)}¢<${effectiveEvThreshold}¢`);
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} YES@${yesAsk}¢ | ourP=${(ourProb*100).toFixed(0)}% mktP=${(yesMarketProb*100).toFixed(0)}% edge=${(yesEdge*100).toFixed(1)}% EV=${yesEV.toFixed(1)}¢${reasons.length ? " — SKIP: " + reasons.join(", ") : " — ✓ PASS"}`);
      }

      if (ourProb >= MIN_CONVICTION && yesEdge >= MIN_EDGE && yesRegimeOk && yesAsk >= MIN_PRICE_CENTS && yesAsk <= effectiveMaxPrice && yesEV >= effectiveEvThreshold) {
        const confScale  = Math.min(1.5, Math.max(0.5, (ourProb - 0.50) / 0.25));
        const contracts  = Math.max(1, Math.floor((this.config.flatBetDollars * confScale) / (yesAsk / 100)));
        const winProfit  = contracts * (100 - yesAsk) * (1 - KALSHI_FEE_RATE) / 100;
        if (winProfit >= minWinProfit) {
          const confidence = signalConfidence(ourProb, yesMarketProb, yesEV, forecast.forecastAgeMinutes);
          signals.push({
            cityCode: city.code, cityName: city.name, ticker: market.ticker,
            side: "yes", priceCents: yesAsk, ourProb, marketProb: yesMarketProb, ev: yesEV, confidence,
            contracts, forecastTemp: marketForecastTemp, hourlyHighTemp: forecast.hourlyHighTemp,
            strikeDesc: strikeLabel, strikeType, forecastAgeMinutes: forecast.forecastAgeMinutes,
            windowType,
          });
        }
      }

      // ── NO side ──
      const noAsk        = market.no_ask;
      const noProb       = 1 - ourProb;
      const noMarketProb = noAsk / 100;
      const noIsWarmBet  = strikeType === "less";
      // NO-side regime filter: only block NO on <X in cold regime (betting warm when it's cold).
      // Previously also blocked NO on >X in warm regime, but that's double-counting — the warm
      // conditions are already baked into the blended forecast. The strike distance guard (1.0σ)
      // and 70% conviction threshold provide sufficient protection without this extra restriction.
      const noRegimeOk   = !(marketRegime === "cold" && noIsWarmBet);
      const noEdge       = noProb - noMarketProb;
      const noEV         = calcEV(noProb, noAsk);

      {
        const reasons: string[] = [];
        if (noProb < MIN_CONVICTION)           reasons.push(`conv ${(noProb*100).toFixed(0)}%<${(MIN_CONVICTION*100).toFixed(0)}%`);
        if (noEdge < MIN_EDGE)                 reasons.push(`edge ${(noEdge*100).toFixed(1)}%<${(MIN_EDGE*100).toFixed(0)}%`);
        if (!noRegimeOk)                       reasons.push(`regime(${marketRegime})`);
        if (noAsk < MIN_PRICE_CENTS)           reasons.push(`price ${noAsk}¢<min`);
        if (strikeType === "between" && noAsk < MIN_BETWEEN_NO_PRICE_CENTS) reasons.push(`between-NO ${noAsk}¢<min${MIN_BETWEEN_NO_PRICE_CENTS}¢`);
        if (noAsk > effectiveMaxPrice)         reasons.push(`price ${noAsk}¢>cap`);
        if (reasons.length === 0 && noEV < effectiveEvThreshold) reasons.push(`EV ${noEV.toFixed(1)}¢<${effectiveEvThreshold}¢`);
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel}  NO@${noAsk}¢ | ourP=${(noProb*100).toFixed(0)}% mktP=${(noMarketProb*100).toFixed(0)}% edge=${(noEdge*100).toFixed(1)}% EV=${noEV.toFixed(1)}¢${reasons.length ? " — SKIP: " + reasons.join(", ") : " — ✓ PASS"}`);
      }

      const noBetweenPriceOk = strikeType !== "between" || noAsk >= MIN_BETWEEN_NO_PRICE_CENTS;
      if (noProb >= MIN_CONVICTION && noEdge >= MIN_EDGE && noRegimeOk && noAsk >= MIN_PRICE_CENTS && noBetweenPriceOk && noAsk <= effectiveMaxPrice && noEV >= effectiveEvThreshold) {
        const confScale  = Math.min(1.5, Math.max(0.5, (noProb - 0.50) / 0.25));
        const contracts  = Math.max(1, Math.floor((this.config.flatBetDollars * confScale) / (noAsk / 100)));
        const winProfit  = contracts * (100 - noAsk) * (1 - KALSHI_FEE_RATE) / 100;
        if (winProfit >= minWinProfit) {
          const confidence = signalConfidence(noProb, noMarketProb, noEV, forecast.forecastAgeMinutes);
          signals.push({
            cityCode: city.code, cityName: city.name, ticker: market.ticker,
            side: "no", priceCents: noAsk, ourProb: noProb, marketProb: noMarketProb, ev: noEV, confidence,
            contracts, forecastTemp: marketForecastTemp, hourlyHighTemp: forecast.hourlyHighTemp,
            strikeDesc: strikeLabel, strikeType, forecastAgeMinutes: forecast.forecastAgeMinutes,
            windowType,
          });
        }
      }
    }

    return signals;
  }

  private strikeDesc(floor: number | null, cap: number | null, type: string): string {
    if (type === "greater" && floor !== null) return `>${floor}°F`;
    if (type === "less"    && cap  !== null) return `<${cap}°F`;
    if (floor !== null && cap !== null)      return `${floor}-${cap}°F`;
    return "unknown";
  }

  private async executeTrade(signal: TradeSignal): Promise<void> {
    this.checkDailyReset();

    // Daily trade limit guard (use bot config's maxDailyTrades if exposed, else cap at 20)
    const maxDaily = 20;
    if (this.dailyTradeCount >= maxDaily) {
      await this.log("warning", `Daily trade limit (${maxDaily}) reached — skipping ${signal.ticker}`);
      return;
    }

    try {
      const clientOrderId = nanoid(16);
      const priceField = signal.side === "yes"
        ? { yes_price: signal.priceCents }
        : { no_price: signal.priceCents };

      const result = await this.kalshi.createOrder({
        ticker: signal.ticker,
        action: "buy",
        side: signal.side,
        count: signal.contracts,
        type: "limit",
        client_order_id: clientOrderId,
        ...priceField,
      });

      this.tradesThisSession++;
      this.dailyTradeCount++;

      // Mark this ticker as held so we don't re-enter same market this session
      this.openPositionTickers.add(signal.ticker);

      // Normalize Kalshi order status to our DB enum ('pending','filled','cancelled','settled')
      // Kalshi returns: 'resting', 'executed', 'canceled', 'pending', 'open'
      const rawStatus = result.order?.status ?? "";
      let dbStatus: "pending" | "filled" | "cancelled" | "settled" = "filled";
      if (rawStatus === "resting" || rawStatus === "open" || rawStatus === "pending") dbStatus = "pending";
      else if (rawStatus === "executed") dbStatus = "filled";
      else if (rawStatus === "canceled" || rawStatus === "cancelled") dbStatus = "cancelled";

      await db.insertTrade({
        userId: this.config.userId,
        kalshiOrderId: result.order.order_id ?? null,
        marketTicker: signal.ticker,
        cityCode: signal.cityCode,
        cityName: signal.cityName,
        strikeDesc: signal.strikeDesc,
        side: signal.side,
        priceCents: signal.priceCents,
        contracts: signal.contracts,
        status: dbStatus,
        won: null,
        pnl: null,
        feeCents: null,
        settledAt: null,
        isPaper: false,
        evCents: signal.ev,
        ourProb: signal.ourProb,
      });

      const msg =
        `Trade placed [${signal.windowType}]: ${signal.cityName} ${signal.side.toUpperCase()} ` +
        `${signal.strikeDesc} @ ${signal.priceCents}¢ x${signal.contracts} | ` +
        `EV: +${signal.ev.toFixed(1)}¢ | ourProb: ${(signal.ourProb * 100).toFixed(1)}% | ` +
        `mktProb: ${(signal.marketProb * 100).toFixed(1)}% | edge: ${((signal.ourProb - signal.marketProb) * 100).toFixed(1)}% | ` +
        `forecast: ${signal.forecastTemp}°F (hourly: ${signal.hourlyHighTemp ?? "n/a"}°F) | ` +
        `forecastAge: ${signal.forecastAgeMinutes}min | kalshiOrderId: ${result.order.order_id ?? "?"}`;

      console.log(`[WeatherBot] ${msg}`);
      await this.log("trade", msg);

    } catch (err: any) {
      console.error(`[WeatherBot] Trade execution failed:`, err.message);
      this.errorsThisSession++;
      await this.log("error", `Trade execution failed for ${signal.ticker}: ${err.message}`);
    }
  }

  private async log(level: "info" | "signal" | "trade" | "error" | "warning", message: string) {
    try {
      await db.insertBotLog({ userId: this.config.userId, level, message });
    } catch (_) {
      // Non-fatal
    }
  }
}