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
// 1-4 cent markets = counterparty is 96-99% certain. These are
// "already settled by reality" traps — the market knows something you don't.
const MIN_PRICE_CENTS = 5;
//
// NEVER trade a market closing within this many minutes.
const MIN_MINUTES_TO_CLOSE = 60;
//
// Hard cap on entry price. Raised to 80¢ to allow buying high-probability contracts.
// The original 45¢ cap forced the bot to only buy low-probability (cheap) contracts,
// which in a trending temperature regime (e.g. cold March) means always betting wrong.
// EV at 80¢ with 90% win probability: 0.9 * 20 * 0.93 - 0.1 * 80 = +8.7¢ — solidly profitable.
const MAX_PRICE_CENTS_HARD_CAP = 80;
//
// Minimum win probability required to place any trade.
// Set to 0.70 to target 80-90% actual win rate. At this threshold combined
// with the regime filter and minimum edge, the bot only enters markets where
// the model has strong conviction aligned with the temperature trend.
const MIN_CONVICTION = 0.70;
//
// Minimum model edge over market-implied probability.
// ourProb must exceed (marketPrice / 100) by at least this amount.
// NOTE: With sigmaMkt calibrated to market-implied volatility, our model naturally
// agrees with the market within 2-5%. Real alpha (NWS updates, ensemble, directionBias)
// produces 2-6% edge. 3% captures real signals without requiring large mispricings.
const MIN_EDGE = 0.03;
//
// Locked EV threshold — not user-editable to prevent under-filtering.
// 6¢ minimum EV per contract after Kalshi 7% fee factored in.
const MIN_EV_CENTS_LOCKED = 6;
//
// Minimum open interest — 200 balances liquidity quality with market availability.
const MIN_LIQUIDITY_LOCKED = 200;

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
    this.openPositionTickers.clear();

    if (this.config.dryRun) {
      try {
        const openPaperTrades = await db.getOpenTrades(this.config.userId, true);
        for (const trade of openPaperTrades) {
          if (trade.marketTicker) this.openPositionTickers.add(trade.marketTicker);
        }
        if (this.openPositionTickers.size > 0) {
          console.log(`[WeatherBot] [PAPER] ${this.openPositionTickers.size} open paper position(s) loaded from DB — will skip these`);
        }
      } catch (err: any) {
        console.warn(`[WeatherBot] Could not load open paper positions from DB: ${err.message}`);
      }
    } else {
      try {
        const openDbTrades = await db.getOpenTrades(this.config.userId, false);
        for (const trade of openDbTrades) {
          if (trade.marketTicker) this.openPositionTickers.add(trade.marketTicker);
        }
      } catch (_) {}

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
          await this.log("signal", paperMsg);
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
    const [ensembleResult, marketsResult] = await Promise.allSettled([
      getEnsembleForecast(city.lat, city.lon, forecast.forecastDate, city.timezone),
      this.kalshi.getMarkets({ series_ticker: city.seriesTicker, status: "open", limit: 20 }),
    ]);

    const ensemble = ensembleResult.status === "fulfilled" ? ensembleResult.value : null;
    const markets  = marketsResult.status  === "fulfilled" ? marketsResult.value.markets : [];

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

    // Consensus forecast: weighted average of NWS + ensemble models.
    // If ensemble unavailable, fall back to NWS only.
    let forecastTemp: number;
    if (ensemble && ensemble.modelCount >= 2) {
      // Blend: NWS 40%, ensemble consensus 60%
      forecastTemp = nwsTemp * 0.40 + ensemble.consensus * 0.60;
      if (ensemble.spread > 3) {
        console.log(`[WeatherBot] ${city.code} — NWS ${nwsTemp}°F, ensemble ${ensemble.consensus}°F (spread ${ensemble.spread}°F) — using blend ${forecastTemp.toFixed(1)}°F`);
      }
    } else {
      forecastTemp = nwsTemp;
    }

    // Apply city-specific directional bias derived from 10,556-market historical analysis.
    // This corrects for systematic NWS over/under-forecasting per city.
    const biasedForecast = forecastTemp + city.directionBias;

    if (markets.length === 0) {
      console.warn(`[WeatherBot] ${city.code} — no open markets found (series: ${city.seriesTicker})`);
      return signals;
    }

    // Temperature regime: compute ONCE per city (not per market)
    const currentMonth = new Date().getMonth();
    const monthlyNormal = city.monthlyNormals[currentMonth];
    const regimeDelta = biasedForecast - monthlyNormal;
    const regime: "cold" | "warm" | "neutral" =
      regimeDelta < -8 ? "cold" :
      regimeDelta >  8 ? "warm" : "neutral";

    if (regime !== "neutral") {
      console.log(`[WeatherBot] ${city.code} — ${regime.toUpperCase()} regime | ${biasedForecast.toFixed(1)}°F vs ${monthlyNormal}°F normal (Δ${regimeDelta > 0 ? "+" : ""}${regimeDelta.toFixed(1)}°F)`);
      await this.log("info", `${city.name} — ${regime.toUpperCase()} regime | forecast ${biasedForecast.toFixed(1)}°F vs ${monthlyNormal}°F normal (Δ${regimeDelta > 0 ? "+" : ""}${regimeDelta.toFixed(1)}°F) — only ${regime}-side bets allowed`);
    }

    // No spread penalty — the >6°F spread guard above already handles strong disagreement.
    const effectiveEvThreshold = evThreshold;

    // Use locked hard cap and min win profit floor
    const effectiveMaxPrice = MAX_PRICE_CENTS_HARD_CAP;
    const minWinProfit = this.config.flatBetDollars * 0.10;

    console.log(`[WeatherBot] ${city.code} — ${markets.length} markets | forecast ${biasedForecast.toFixed(1)}°F (bias ${city.directionBias > 0 ? "+" : ""}${city.directionBias}°F) | regime: ${regime}`);

    for (const market of markets) {
      const floor      = market.floor_strike ?? null;
      const cap        = market.cap_strike ?? null;
      const strikeType = market.strike_type ?? "between";
      const strikeLabel = this.strikeDesc(floor, cap, strikeType);
      const oi  = market.open_interest ?? 0;
      const vol = market.volume ?? 0;
      const liquidity = oi > 0 ? oi : vol; // prefer OI, fall back to volume

      if (!["greater", "less", "between"].includes(strikeType)) continue;

      // ── Pre-probability guards (log rejections for diagnostics) ──
      // Only skip on liquidity when data is actually populated (> 0).
      // Kalshi returns open_interest: 0 for many fresh daily markets.
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

      const ourProb = probForStrike(biasedForecast, city.sigmaMkt, floor, cap, strikeType);

      // ── YES side ──
      const yesAsk        = market.yes_ask;
      const yesIsWarmBet  = strikeType === "greater";
      const yesRegimeOk   = !(regime === "cold" && yesIsWarmBet) && !(regime === "warm" && !yesIsWarmBet && strikeType === "less");
      const yesMarketProb = yesAsk / 100;
      const yesEdge       = ourProb - yesMarketProb;
      const yesEV         = calcEV(ourProb, yesAsk);

      {
        const reasons: string[] = [];
        if (ourProb < MIN_CONVICTION)          reasons.push(`conv ${(ourProb*100).toFixed(0)}%<${(MIN_CONVICTION*100).toFixed(0)}%`);
        if (yesEdge < MIN_EDGE)                reasons.push(`edge ${(yesEdge*100).toFixed(1)}%<${(MIN_EDGE*100).toFixed(0)}%`);
        if (!yesRegimeOk)                      reasons.push(`regime(${regime})`);
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
            contracts, forecastTemp, hourlyHighTemp: forecast.hourlyHighTemp,
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
      const noRegimeOk   = !(regime === "cold" && noIsWarmBet) && !(regime === "warm" && !noIsWarmBet && strikeType === "greater");
      const noEdge       = noProb - noMarketProb;
      const noEV         = calcEV(noProb, noAsk);

      {
        const reasons: string[] = [];
        if (noProb < MIN_CONVICTION)           reasons.push(`conv ${(noProb*100).toFixed(0)}%<${(MIN_CONVICTION*100).toFixed(0)}%`);
        if (noEdge < MIN_EDGE)                 reasons.push(`edge ${(noEdge*100).toFixed(1)}%<${(MIN_EDGE*100).toFixed(0)}%`);
        if (!noRegimeOk)                       reasons.push(`regime(${regime})`);
        if (noAsk < MIN_PRICE_CENTS)           reasons.push(`price ${noAsk}¢<min`);
        if (noAsk > effectiveMaxPrice)         reasons.push(`price ${noAsk}¢>cap`);
        if (reasons.length === 0 && noEV < effectiveEvThreshold) reasons.push(`EV ${noEV.toFixed(1)}¢<${effectiveEvThreshold}¢`);
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel}  NO@${noAsk}¢ | ourP=${(noProb*100).toFixed(0)}% mktP=${(noMarketProb*100).toFixed(0)}% edge=${(noEdge*100).toFixed(1)}% EV=${noEV.toFixed(1)}¢${reasons.length ? " — SKIP: " + reasons.join(", ") : " — ✓ PASS"}`);
      }

      if (noProb >= MIN_CONVICTION && noEdge >= MIN_EDGE && noRegimeOk && noAsk >= MIN_PRICE_CENTS && noAsk <= effectiveMaxPrice && noEV >= effectiveEvThreshold) {
        const confScale  = Math.min(1.5, Math.max(0.5, (noProb - 0.50) / 0.25));
        const contracts  = Math.max(1, Math.floor((this.config.flatBetDollars * confScale) / (noAsk / 100)));
        const winProfit  = contracts * (100 - noAsk) * (1 - KALSHI_FEE_RATE) / 100;
        if (winProfit >= minWinProfit) {
          const confidence = signalConfidence(noProb, noMarketProb, noEV, forecast.forecastAgeMinutes);
          signals.push({
            cityCode: city.code, cityName: city.name, ticker: market.ticker,
            side: "no", priceCents: noAsk, ourProb: noProb, marketProb: noMarketProb, ev: noEV, confidence,
            contracts, forecastTemp, hourlyHighTemp: forecast.hourlyHighTemp,
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