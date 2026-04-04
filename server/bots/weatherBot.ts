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
// Reverted 10¢ → 20¢ (2026-03-29, sim 6 post-run): Mid-run drop to 10¢ contributed to
// wrong-directional bets (BOS, AUS, DC). Sim4 proof: ALL 12 bets at ≤18¢ lost (0% win rate).
// At <20¢ a 3°F forecast error (within 1σ for most cities) completely wipes edge.
// Our high-confidence target trades (MSY-type, 70%+ ourProb) naturally price at 22-35¢
// where market underprices due to not using bias+ensemble. 20¢ is the correct floor.
const MIN_PRICE_CENTS = 20;
//
// NEVER trade a market closing within this many minutes.
const MIN_MINUTES_TO_CLOSE = 60;
//
// Hard cap on entry price.
// Raised 60¢ → 75¢ (2026-03-26, sim 5).
// Raised 75¢ → 82¢ (2026-03-29, sim 6).
// Rationale: contracts priced 75-82¢ reflect ~80-90% probability in the market.
// Our directional safety guard (YES ≥0.5σ favorable, NO ≥1.5σ safe) replaces
// the old MAX_STRIKE_SIGMA guard and ensures we only enter when the forecast
// strongly supports the bet direction — not just when the strike is nearby.
// EV=8¢ filter: at 82¢ entry requires ourProb ≥ 88% to pass.
// Breakeven real WR: 75¢=76.0%, 80¢=81.0%, 82¢=83.2%.
const MAX_PRICE_CENTS_HARD_CAP    = 82;
const NO_HIGH_CONF_MAX_PRICE_CENTS = 90; // NO trades with safety ≥ 1.5σ may trade up to 90¢
//
// Minimum win probability required to place any trade.
// Uses city.sigma (NWS forecast accuracy) for probability calculations — NOT
// sigmaMkt (market-implied vol which is 70% wider and inflates deep-OTM probabilities).
// Lowered 70% → 65% (2026-03-26): spring warm season gap.
// Lowered 65% → 60% (2026-03-26): regime filter fix means some signals now reach conviction check.
// Lowered 60% → 55% (2026-03-29, sim 6): directional safety guard (YES ≥0.5σ, NO ≥1.5σ) provides
//   structural protection that the regime filter was attempting to give.
// Reverted 50% → 65% (2026-03-29, sim 6 post-run): 50% is a coin flip — not conviction.
// Mid-run drop to 50% (combined with YES_SAFETY=0.0) allowed 51% ourProb bets and caused
// wrong-directional losses (BOS/AUS/DC). 65% requires forecast to strongly favor outcome:
// at sigma=3.2°F (NYC), 65% ourProb means forecast is ~1σ past the strike — clear edge.
// High-value target: MSY-type trades at 70%+ ourProb are the model. 65% is the floor.
// Lowered 60% → 58% (2026-03-31): safety guards (YES ≥0.5σ, NO ≥1.2σ) are the structural
//   protection. 58% vs 60% with intact safety guards is not materially different in outcome
//   but unlocks ~10-15% more signals on KXLOWT and high-sigma cities (CHI/MSP).
const MIN_CONVICTION = 0.58;
//
// Minimum model edge over market-implied probability.
// Raised from 0.03 → 0.05: weather markets reprice 2-5% daily as new NWS
// updates propagate. A 3% edge is indistinguishable from daily repricing noise.
// Raised 0.05 → 0.08 (2026-03-29, sim 6): with MIN_CONVICTION lowered to 55%,
// a stronger edge requirement prevents marginal entries. 8% edge at 55% ourProb
// requires market pricing ≤47¢ YES — a meaningful pricing gap, not noise.
// Tiered (2026-03-31): high-conviction trades (ourProb ≥ 72%) use 7% — at that conviction
//   level the market gap is real signal, not repricing noise. Low-conviction keeps 8%.
const MIN_EDGE = 0.08; // floor; high-conviction trades use MIN_EDGE_HIGH_CONV below
const MIN_EDGE_HIGH_CONV = 0.07; // applied when ourProb ≥ 0.72
const HIGH_CONV_EDGE_THRESHOLD = 0.72;
//
// Locked EV threshold — not user-editable to prevent under-filtering.
// Raised from 6¢ → 10¢: ensures the trade has meaningful expected profit.
// Lowered 10¢ → 8¢ (2026-03-29, sim 6): high-probability bets (priced 75-82¢) have
// naturally compressed EV even when ourProb strongly agrees. E.g. at 85% ourProb and
// 80¢ price: EV = 0.85*20*0.93 - 0.15*80 = 15.8 - 12 = 3.8¢ — would fail 10¢ bar.
// 8¢ bar still requires real edge; it just doesn't penalize high-conviction high-price bets.
const MIN_EV_CENTS_LOCKED = 8;
//
// Minimum open interest — lowered from 200 → 100 to surface more cheap contracts
// (the 21-55¢ range has lower OI than expensive markets). Still filters dead markets.
const MIN_LIQUIDITY_LOCKED = 100;
//
// YES directional safety margin (σ). Forecast must be this many sigma past the strike
// in the favorable direction before placing a YES bet.
// Was correctly 0.5σ at sim 6 start; dropped to 0.0σ mid-run which caused BOS/AUS/DC losses.
// Reverted to 0.5σ: requires forecast to be half a sigma past strike — not merely on the
// right side of it. 0.0σ technically blocks wrong-direction bets (ourProb <50%), but 0.5σ
// provides a real buffer against ensemble flips (BOS flip: safety was 0.02σ when bet placed).
const YES_SAFETY_SIGMA = 0.5;
// Minimum absolute forecast distance from strike (°F).
// Sim 6 post-mortem: trades with ≤2°F margin had 17% win rate; >2°F had 89% win rate.
// NWS single-day RMSE is ~3°F for most cities — a 0.3°F or 1.6°F margin is essentially
// a coin flip masked by a high ourProb (model overconfidence near the strike).
// This guard is applied AFTER the sigma-based safety check — it catches cases where
// sigma is small (SFO σ=2.2) so 0.5σ ≈ 1.1°F, still too thin.
const MIN_STRIKE_MARGIN_F = 3.0;
//
// Ensemble spread guard REMOVED (2026-03-29, sim 7): The city-level spread guard was redundant
// with the per-market NWS-ensemble divergence guard (4°F, below in analyzeCity). The spread guard
// was also unnormalized — a 7°F spread means very different things for MIA (σ=2.1) vs MSP (σ=4.2).
// High-σ cities like CHI and MSP were being skipped on their best trading days.
// The per-market NWS-divergence guard provides better protection at the right granularity.

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
const LOW_FREQ_INTERVAL_MS      = 10 * 60 * 1000;   // 10 min

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
  // Track city+date → sides held to prevent cross-side hedges (YES + NO on same city/day).
  // Same-side stacking (two NO bets at different strikes) is allowed — they're correlated wins,
  // not hedges. Cross-side (YES + NO) is blocked: if actual temp lands between the strikes,
  // both lose simultaneously. Key: "${cityCode}:${YYYY-MM-DD}", value: set of sides held.
  private openPositionCityDates: Map<string, Set<"yes" | "no">> = new Map();
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
        this.openPositionCityDates.clear();
        for (const trade of openPaperTrades) {
          if (trade.marketTicker) {
            this.openPositionTickers.add(trade.marketTicker);
            const d = parseDateFromTicker(trade.marketTicker);
            if (d && trade.cityCode && trade.side) {
              const key = `${trade.cityCode}:${d}`;
              if (!this.openPositionCityDates.has(key)) this.openPositionCityDates.set(key, new Set());
              this.openPositionCityDates.get(key)!.add(trade.side as "yes" | "no");
            }
          }
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
        this.openPositionCityDates.clear();
        for (const trade of openDbTrades) {
          if (trade.marketTicker) {
            this.openPositionTickers.add(trade.marketTicker);
            const d = parseDateFromTicker(trade.marketTicker);
            if (d && trade.cityCode && trade.side) {
              const key = `${trade.cityCode}:${d}`;
              if (!this.openPositionCityDates.has(key)) this.openPositionCityDates.set(key, new Set());
              this.openPositionCityDates.get(key)!.add(trade.side as "yes" | "no");
            }
          }
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
      `prob_sigma: city.sigma (NWS accuracy) | between: ELIMINATED | ` +
      `MIN_PRICE: ${MIN_PRICE_CENTS}¢ | MIN_CONVICTION: ${(MIN_CONVICTION * 100).toFixed(0)}% | ` +
      `MIN_EDGE: ${(MIN_EDGE * 100).toFixed(0)}% | MIN_EV: ${MIN_EV_CENTS_LOCKED}¢ | ` +
      `MAX_PRICE: ${MAX_PRICE_CENTS_HARD_CAP}¢ | YES_SAFETY: ${YES_SAFETY_SIGMA}σ | NO_SAFETY: 1.2σ (1.5σ→90¢ cap)`
    );
    await this.log(
      "info",
      `Scan params — between: ELIMINATED | MIN_PRICE: ${MIN_PRICE_CENTS}¢ | MIN_CONVICTION: ${(MIN_CONVICTION * 100).toFixed(0)}% | ` +
      `MIN_EDGE: ${(MIN_EDGE * 100).toFixed(0)}% | MIN_EV: ${MIN_EV_CENTS_LOCKED}¢ | MAX_PRICE: ${MAX_PRICE_CENTS_HARD_CAP}¢ | ` +
      `YES_SAFETY: ${YES_SAFETY_SIGMA}σ | NO_SAFETY: 1.2σ (1.5σ→90¢ cap)`
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
            tomorrowLow: f.tomorrowLowTemp,
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
            forecastTemp: signal.forecastTemp ?? null,
          });
          this.dailyTradeCount++;
          // Mark ticker as held so we don't re-enter this market in future scans
          this.openPositionTickers.add(signal.ticker);
          const sigDate = parseDateFromTicker(signal.ticker);
          if (sigDate && signal.cityCode) {
            const key = `${signal.cityCode}:${sigDate}`;
            if (!this.openPositionCityDates.has(key)) this.openPositionCityDates.set(key, new Set());
            this.openPositionCityDates.get(key)!.add(signal.side);
          }
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
    const [ensembleResult, tomorrowEnsembleResult, dayPlusTwoEnsembleResult, marketsResult, lowMarketsResult] = await Promise.allSettled([
      getEnsembleForecast(city.lat, city.lon, forecast.forecastDate, city.timezone),
      forecast.tomorrowHighTemp != null
        ? getEnsembleForecast(city.lat, city.lon, forecast.tomorrowForecastDate, city.timezone)
        : Promise.resolve(null),
      forecast.dayPlusTwoHighTemp != null
        ? getEnsembleForecast(city.lat, city.lon, forecast.dayPlusTwoDate, city.timezone)
        : Promise.resolve(null),
      this.kalshi.getMarkets({ series_ticker: city.seriesTicker, status: "open", limit: 25 }),
      city.lowSeriesTicker
        ? this.kalshi.getMarkets({ series_ticker: city.lowSeriesTicker, status: "open", limit: 25 })
        : Promise.resolve({ markets: [] }),
    ]);

    const ensemble           = ensembleResult.status           === "fulfilled" ? ensembleResult.value           : null;
    const tomorrowEnsemble   = tomorrowEnsembleResult.status   === "fulfilled" ? tomorrowEnsembleResult.value   : null;
    const dayPlusTwoEnsemble = dayPlusTwoEnsembleResult.status === "fulfilled" ? dayPlusTwoEnsembleResult.value : null;
    const markets            = marketsResult.status            === "fulfilled" ? marketsResult.value.markets    : [];
    const lowMarkets         = lowMarketsResult.status         === "fulfilled" ? lowMarketsResult.value.markets : [];

    if (marketsResult.status === "rejected") {
      console.warn(`[WeatherBot] Failed to fetch markets for ${city.code}: ${(marketsResult.reason as any)?.message}`);
    }

    if (markets.length === 0) {
      console.warn(`[WeatherBot] ${city.code} — no open markets found (series: ${city.seriesTicker})`);
      return signals;
    }

    const effectiveEvThreshold = evThreshold;
    const effectiveMaxPrice = MAX_PRICE_CENTS_HARD_CAP;
    const minWinProfit = this.config.flatBetDollars * 0.15;

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
      // ── Sim 6: between bets eliminated permanently ──
      // Between bets (1°F range) have structural failure: even at 2σ from forecast,
      // the range has ~4-5% chance of being hit by routine forecast error. Model
      // overconfidence (97% ourProb → real WR ~40-50%) confirmed in both sim 4 and sim 5.
      if (strikeType === "between") continue;

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
      const isDay2     = settlementDate === forecast.dayPlusTwoDate && forecast.dayPlusTwoHighTemp != null;
      if (!isToday && !isTomorrow && !isDay2) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: settles ${settlementDate}, no forecast available`);
        continue;
      }
      if (isTomorrow && forecast.tomorrowHighTemp == null) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} — skip: tomorrow market but no NWS tomorrow forecast yet`);
        continue;
      }
      const marketNwsRaw = isToday ? nwsTemp : isTomorrow ? forecast.tomorrowHighTemp! : forecast.dayPlusTwoHighTemp!;
      const marketEns    = isToday ? ensemble : isTomorrow ? tomorrowEnsemble : dayPlusTwoEnsemble;
      // Day+2 forecasts carry more uncertainty — widen sigma by 30% to account for longer horizon
      const marketSigma  = isDay2 ? city.sigma * 1.3 : city.sigma;
      let marketForecastTemp: number;
      if (marketEns && marketEns.modelCount >= 2) {
        marketForecastTemp = marketNwsRaw * 0.40 + marketEns.consensus * 0.60;
      } else {
        marketForecastTemp = marketNwsRaw;
      }
      const marketBiasedForecast = marketForecastTemp + city.directionBias;

      // ── NWS vs ensemble divergence — soft confidence reducer ──
      // Instead of hard-blocking, large divergence blends ourProb toward 0.5,
      // reducing edge/EV on uncertain signals without fully excluding them.
      // Ramp: 0% penalty at ≤2°F → 25% blend toward 0.5 at ≥6°F divergence.
      // Strong signals still pass; marginal ones get washed out naturally.
      let divergenceBlend = 0;
      let nwsEnsDivergence = 0;
      if (marketEns && marketEns.modelCount >= 2) {
        nwsEnsDivergence = Math.abs(marketNwsRaw - marketForecastTemp);
        if (nwsEnsDivergence > 2.0) {
          divergenceBlend = Math.min(0.25, 0.25 * (nwsEnsDivergence - 2.0) / 4.0);
        }
      }

      // ── Directional safety margins (sim 6) ──
      // Computed per-side below inside each YES/NO evaluation block.
      // YES bets require forecast to be on the favorable side by ≥0.5σ.
      // NO bets require forecast to be well away from the strike by ≥1.5σ.
      // This replaces the old symmetric MAX_STRIKE_SIGMA=1.0 guard which
      // blocked trades regardless of direction (e.g. it blocked NO on >X
      // where strike is safely far ABOVE forecast — exactly the good NO bets).

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
      const cityDateKey = `${city.code}:${settlementDate}`;
      if (strikeType === "between" && city.sigmaMkt > 5.0 && windowType === "low-freq") continue;

      // Use city.sigma (actual NWS forecast accuracy) — NOT sigmaMkt (market-implied vol).
      // sigmaMkt is ~70% wider than sigma; using it inflates deep-OTM probabilities by 2x,
      // creating fake edges on cheap contracts (e.g., 24% vs true ~11% for BOS >51°F @ 5¢).
      // Apply divergence penalty: blend toward 0.5 when NWS and ensemble disagree.
      const ourProbRaw = probForStrike(marketBiasedForecast, marketSigma, floor, cap, strikeType);
      const ourProb    = divergenceBlend > 0
        ? ourProbRaw * (1 - divergenceBlend) + 0.5 * divergenceBlend
        : ourProbRaw;

      // ── YES side ──
      const yesAsk        = market.yes_ask;
      const yesMarketProb = yesAsk / 100;
      const yesEdge       = ourProb - yesMarketProb;
      const yesEV         = calcEV(ourProb, yesAsk);

      // Directional safety for YES: forecast must be ≥ YES_SAFETY_SIGMA past the strike (module-level).
      // YES >X (greater): need forecast ≥ floor → safety = (forecast - floor) / σ ≥ 0.5
      // YES <X (less):    need forecast ≤ cap  → safety = (cap - forecast)   / σ ≥ 0.5
      // 0.5σ means forecast must be half a sigma past the strike — not just barely on the right side.
      // This buffers against ensemble flips (BOS mid-run: safety was only 0.02σ when bet placed).
      let yesSafety = 0;
      if (strikeType === "greater" && floor !== null) {
        yesSafety = (marketBiasedForecast - floor) / marketSigma;
      } else if (strikeType === "less" && cap !== null) {
        yesSafety = (cap - marketBiasedForecast) / marketSigma;
      }
      const yesSafetyOk = yesSafety >= YES_SAFETY_SIGMA;
      // Absolute margin guard: forecast must be >MIN_STRIKE_MARGIN_F from strike.
      // Even at 0.5σ safety, low-σ cities (SFO σ=2.2 → 0.5σ=1.1°F) can slip through
      // with a margin so thin that normal NWS error flips the result.
      let yesMargin = 0;
      if (strikeType === "greater" && floor !== null) yesMargin = marketBiasedForecast - floor;
      else if (strikeType === "less" && cap !== null) yesMargin = cap - marketBiasedForecast;
      const yesMarginOk = yesMargin >= MIN_STRIKE_MARGIN_F;
      const yesMinEdge = ourProb >= HIGH_CONV_EDGE_THRESHOLD ? MIN_EDGE_HIGH_CONV : MIN_EDGE;

      {
        const reasons: string[] = [];
        if (ourProb < MIN_CONVICTION)          reasons.push(`conv ${(ourProb*100).toFixed(0)}%<${(MIN_CONVICTION*100).toFixed(0)}%`);
        if (yesEdge < yesMinEdge)              reasons.push(`edge ${(yesEdge*100).toFixed(1)}%<${(yesMinEdge*100).toFixed(0)}%`);
        if (!yesSafetyOk)                      reasons.push(`dir-safety ${yesSafety.toFixed(2)}σ<${YES_SAFETY_SIGMA}σ`);
        if (!yesMarginOk)                      reasons.push(`margin ${yesMargin.toFixed(1)}°F<${MIN_STRIKE_MARGIN_F}°F`);
        if (yesAsk < MIN_PRICE_CENTS)          reasons.push(`price ${yesAsk}¢<min`);
        if (yesAsk > effectiveMaxPrice)        reasons.push(`price ${yesAsk}¢>cap`);
        if (reasons.length === 0 && yesEV < effectiveEvThreshold) reasons.push(`EV ${yesEV.toFixed(1)}¢<${effectiveEvThreshold}¢`);
        const divTag = divergenceBlend > 0 ? ` divAdj=${(ourProbRaw*100).toFixed(0)}%→${(ourProb*100).toFixed(0)}%(${(divergenceBlend*100).toFixed(0)}%pen@${nwsEnsDivergence.toFixed(1)}°F)` : "";
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} YES@${yesAsk}¢ | ourP=${(ourProb*100).toFixed(0)}% mktP=${(yesMarketProb*100).toFixed(0)}% edge=${(yesEdge*100).toFixed(1)}% EV=${yesEV.toFixed(1)}¢ safety=${yesSafety.toFixed(2)}σ nws=${marketNwsRaw}°F${divTag}${reasons.length ? " — SKIP: " + reasons.join(", ") : " — ✓ PASS"}`);
      }
      if (this.openPositionCityDates.get(cityDateKey)?.has("no")) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel} YES — skip: would hedge existing NO position (conflict guard)`);
      } else if (ourProb >= MIN_CONVICTION && yesEdge >= yesMinEdge && yesSafetyOk && yesMarginOk && yesAsk >= MIN_PRICE_CENTS && yesAsk <= effectiveMaxPrice && yesEV >= effectiveEvThreshold) {
        const confScale  = Math.min(3.0, Math.max(0.5, (ourProb - 0.50) / 0.15));
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
      const noEdge       = noProb - noMarketProb;
      const noEV         = calcEV(noProb, noAsk);

      // Directional safety for NO: strike must be well away from forecast in the favorable direction by ≥1.5σ.
      // NO >X (greater): we bet it won't exceed floor. Need floor safely above forecast.
      //   safety = (floor - forecast) / σ — positive means floor is above forecast (good)
      // NO <X (less): we bet it won't fall below cap. Need cap safely below forecast.
      //   safety = (forecast - cap) / σ — positive means forecast is above cap (good)
      const NO_SAFETY_SIGMA = 1.2;
      let noSafety = 0;
      if (strikeType === "greater" && floor !== null) {
        noSafety = (floor - marketBiasedForecast) / marketSigma;
      } else if (strikeType === "less" && cap !== null) {
        noSafety = (marketBiasedForecast - cap) / marketSigma;
      }
      const noSafetyOk = noSafety >= NO_SAFETY_SIGMA;
      let noMargin = 0;
      if (strikeType === "greater" && floor !== null) noMargin = floor - marketBiasedForecast;
      else if (strikeType === "less" && cap !== null) noMargin = marketBiasedForecast - cap;
      const noMarginOk = noMargin >= MIN_STRIKE_MARGIN_F;
      const noMinEdge = noProb >= HIGH_CONV_EDGE_THRESHOLD ? MIN_EDGE_HIGH_CONV : MIN_EDGE;

      {
        const noMaxPrice = noSafety >= 1.5 ? NO_HIGH_CONF_MAX_PRICE_CENTS : effectiveMaxPrice;
        const reasons: string[] = [];
        if (noProb < MIN_CONVICTION)           reasons.push(`conv ${(noProb*100).toFixed(0)}%<${(MIN_CONVICTION*100).toFixed(0)}%`);
        if (noEdge < noMinEdge)                reasons.push(`edge ${(noEdge*100).toFixed(1)}%<${(noMinEdge*100).toFixed(0)}%`);
        if (!noSafetyOk)                       reasons.push(`dir-safety ${noSafety.toFixed(2)}σ<${NO_SAFETY_SIGMA}σ`);
        if (!noMarginOk)                       reasons.push(`margin ${noMargin.toFixed(1)}°F<${MIN_STRIKE_MARGIN_F}°F`);
        if (noAsk < MIN_PRICE_CENTS)           reasons.push(`price ${noAsk}¢<min`);
        if (noAsk > noMaxPrice)                reasons.push(`price ${noAsk}¢>cap(${noMaxPrice}¢)`);
        if (reasons.length === 0 && noEV < effectiveEvThreshold) reasons.push(`EV ${noEV.toFixed(1)}¢<${effectiveEvThreshold}¢`);
        const noRawProb = 1 - ourProbRaw;
        const noDivTag = divergenceBlend > 0 ? ` divAdj=${(noRawProb*100).toFixed(0)}%→${(noProb*100).toFixed(0)}%(${(divergenceBlend*100).toFixed(0)}%pen@${nwsEnsDivergence.toFixed(1)}°F)` : "";
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel}  NO@${noAsk}¢ | ourP=${(noProb*100).toFixed(0)}% mktP=${(noMarketProb*100).toFixed(0)}% edge=${(noEdge*100).toFixed(1)}% EV=${noEV.toFixed(1)}¢ safety=${noSafety.toFixed(2)}σ${noDivTag}${reasons.length ? " — SKIP: " + reasons.join(", ") : " — ✓ PASS"}`);
      }

      if (this.openPositionCityDates.get(cityDateKey)?.has("yes")) {
        console.log(`[WeatherBot]   ${city.code} ${strikeLabel}  NO — skip: would hedge existing YES position (conflict guard)`);
      } else if (noProb >= MIN_CONVICTION && noEdge >= noMinEdge && noSafetyOk && noMarginOk && noAsk >= MIN_PRICE_CENTS && noAsk <= (noSafety >= 1.5 ? NO_HIGH_CONF_MAX_PRICE_CENTS : effectiveMaxPrice) && noEV >= effectiveEvThreshold) {
        // NO safety bonus: ≥1.5σ clearance gets +0.5× on top of the base confScale
        const baseConfScale = Math.min(3.0, Math.max(0.5, (noProb - 0.50) / 0.15));
        const confScale  = noSafety >= 1.5 ? Math.min(3.0, baseConfScale + 0.5) : baseConfScale;
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

    // ── KXLOW markets (overnight low temperature) ──────────────────────────────
    // Scan low-temperature series if city has a lowSeriesTicker and markets are available.
    // Uses overnight low forecast + sigmaLow (defaults to sigma * 1.15).
    if (city.lowSeriesTicker && lowMarkets.length > 0) {
      const sigmaLow = city.sigmaLow ?? city.sigma * 1.15;
      const todayLow    = forecast.lowTemp;
      const tomorrowLow = forecast.tomorrowLowTemp;
      console.log(`[WeatherBot] ${city.code} LOW — ${lowMarkets.length} markets | NWS low today ${todayLow}°F${tomorrowLow != null ? ` / tomorrow ${tomorrowLow}°F` : ""} | σ=${sigmaLow.toFixed(1)}°F`);

      for (const market of lowMarkets) {
        const floor      = market.floor_strike ?? null;
        const cap        = market.cap_strike ?? null;
        const strikeType = market.strike_type ?? "between";
        if (strikeType === "between" || !["greater", "less"].includes(strikeType)) continue;

        const strikeLabel    = this.strikeDesc(floor, cap, strikeType);
        const oi             = market.open_interest ?? 0;
        const vol            = market.volume ?? 0;
        const liquidity      = oi > 0 ? oi : vol;
        const settlementDate = parseDateFromTicker(market.ticker) ?? forecast.forecastDate;
        const isToday        = settlementDate === forecast.forecastDate;
        const isTomorrow     = settlementDate === forecast.tomorrowForecastDate;
        if (!isToday && !isTomorrow) continue;
        if (isTomorrow && tomorrowLow == null) continue;

        const lowNwsRaw         = isToday ? todayLow : tomorrowLow!;
        const lowBiasedForecast = lowNwsRaw + city.directionBias;

        if (liquidity > 0 && liquidity < MIN_LIQUIDITY_LOCKED) continue;
        const minsLeft = minutesToClose(market);
        if (minsLeft < MIN_MINUTES_TO_CLOSE) continue;
        if (this.openPositionTickers.has(market.ticker)) continue;
        // Use same key format as HIGH markets so the shared openPositionCityDates map
        // blocks cross-side hedges correctly (was :low suffix → conflict guard never fired).
        const cityDateKey = `${city.code}:${settlementDate}`;

        const lowProb    = probForStrike(lowBiasedForecast, sigmaLow, floor, cap, strikeType);
        const yesAsk     = market.yes_ask;
        const yesEdge    = lowProb - yesAsk / 100;
        const yesEV      = calcEV(lowProb, yesAsk);
        let yesSafety    = 0;
        if (strikeType === "greater" && floor !== null) yesSafety = (lowBiasedForecast - floor) / sigmaLow;
        else if (strikeType === "less" && cap !== null) yesSafety = (cap - lowBiasedForecast) / sigmaLow;
        const yesSafetyOk = yesSafety >= YES_SAFETY_SIGMA;

        console.log(`[WeatherBot]   ${city.code} LOW ${strikeLabel} YES@${yesAsk}¢ | ourP=${(lowProb*100).toFixed(0)}% edge=${(yesEdge*100).toFixed(1)}% EV=${yesEV.toFixed(1)}¢ safety=${yesSafety.toFixed(2)}σ nws=${lowNwsRaw}°F${lowProb >= MIN_CONVICTION && yesEdge >= MIN_EDGE && yesSafetyOk && yesAsk >= MIN_PRICE_CENTS && yesAsk <= effectiveMaxPrice && yesEV >= effectiveEvThreshold ? " — ✓ PASS" : " — SKIP"}`);

        const lowYesMinEdge = lowProb >= HIGH_CONV_EDGE_THRESHOLD ? MIN_EDGE_HIGH_CONV : MIN_EDGE;
        let lowYesMargin = 0;
        if (strikeType === "greater" && floor !== null) lowYesMargin = lowBiasedForecast - floor;
        else if (strikeType === "less" && cap !== null) lowYesMargin = cap - lowBiasedForecast;
        const lowYesMarginOk = lowYesMargin >= MIN_STRIKE_MARGIN_F;
        if (this.openPositionCityDates.get(cityDateKey)?.has("no")) {
          console.log(`[WeatherBot]   ${city.code} LOW ${strikeLabel} YES — skip: would hedge existing NO position (conflict guard)`);
        } else if (lowProb >= MIN_CONVICTION && yesEdge >= lowYesMinEdge && yesSafetyOk && lowYesMarginOk && yesAsk >= MIN_PRICE_CENTS && yesAsk <= effectiveMaxPrice && yesEV >= effectiveEvThreshold) {
          const confScale = Math.min(3.0, Math.max(0.5, (lowProb - 0.50) / 0.15));
          const contracts = Math.max(1, Math.floor((this.config.flatBetDollars * confScale) / (yesAsk / 100)));
          const winProfit = contracts * (100 - yesAsk) * (1 - KALSHI_FEE_RATE) / 100;
          if (winProfit >= minWinProfit) {
            const confidence = signalConfidence(lowProb, yesAsk / 100, yesEV, forecast.forecastAgeMinutes);
            signals.push({
              cityCode: city.code, cityName: city.name, ticker: market.ticker,
              side: "yes", priceCents: yesAsk, ourProb: lowProb, marketProb: yesAsk / 100, ev: yesEV, confidence,
              contracts, forecastTemp: lowBiasedForecast, hourlyHighTemp: forecast.hourlyHighTemp,
              strikeDesc: strikeLabel, strikeType, forecastAgeMinutes: forecast.forecastAgeMinutes,
              windowType,
            });
          }
        }

        const noAsk    = market.no_ask;
        const noProb   = 1 - lowProb;
        const noEdge   = noProb - noAsk / 100;
        const noEV     = calcEV(noProb, noAsk);
        const NO_SAFETY_SIGMA_LOW = 1.2;
        let noSafety   = 0;
        if (strikeType === "greater" && floor !== null) noSafety = (floor - lowBiasedForecast) / sigmaLow;
        else if (strikeType === "less" && cap !== null) noSafety = (lowBiasedForecast - cap) / sigmaLow;
        const noSafetyOk  = noSafety >= NO_SAFETY_SIGMA_LOW;
        const noMaxPrice  = noSafety >= 1.5 ? NO_HIGH_CONF_MAX_PRICE_CENTS : effectiveMaxPrice;

        const lowNoMinEdge = noProb >= HIGH_CONV_EDGE_THRESHOLD ? MIN_EDGE_HIGH_CONV : MIN_EDGE;
        let lowNoMargin = 0;
        if (strikeType === "greater" && floor !== null) lowNoMargin = floor - lowBiasedForecast;
        else if (strikeType === "less" && cap !== null) lowNoMargin = lowBiasedForecast - cap;
        const lowNoMarginOk = lowNoMargin >= MIN_STRIKE_MARGIN_F;
        if (this.openPositionCityDates.get(cityDateKey)?.has("yes")) {
          console.log(`[WeatherBot]   ${city.code} LOW ${strikeLabel}  NO — skip: would hedge existing YES position (conflict guard)`);
        } else if (noProb >= MIN_CONVICTION && noEdge >= lowNoMinEdge && noSafetyOk && lowNoMarginOk && noAsk >= MIN_PRICE_CENTS && noAsk <= noMaxPrice && noEV >= effectiveEvThreshold) {
          const lowNoSafety = noSafety;
          const baseLowNoScale = Math.min(3.0, Math.max(0.5, (noProb - 0.50) / 0.15));
          const confScale = lowNoSafety >= 1.5 ? Math.min(3.0, baseLowNoScale + 0.5) : baseLowNoScale;
          const contracts = Math.max(1, Math.floor((this.config.flatBetDollars * confScale) / (noAsk / 100)));
          const winProfit = contracts * (100 - noAsk) * (1 - KALSHI_FEE_RATE) / 100;
          if (winProfit >= minWinProfit) {
            const confidence = signalConfidence(noProb, noAsk / 100, noEV, forecast.forecastAgeMinutes);
            signals.push({
              cityCode: city.code, cityName: city.name, ticker: market.ticker,
              side: "no", priceCents: noAsk, ourProb: noProb, marketProb: noAsk / 100, ev: noEV, confidence,
              contracts, forecastTemp: lowBiasedForecast, hourlyHighTemp: forecast.hourlyHighTemp,
              strikeDesc: strikeLabel, strikeType, forecastAgeMinutes: forecast.forecastAgeMinutes,
              windowType,
            });
          }
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
      const sigDate = parseDateFromTicker(signal.ticker);
      if (sigDate && signal.cityCode) {
        const key = `${signal.cityCode}:${sigDate}`;
        if (!this.openPositionCityDates.has(key)) this.openPositionCityDates.set(key, new Set());
        this.openPositionCityDates.get(key)!.add(signal.side);
      }

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
        forecastTemp: signal.forecastTemp ?? null,
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