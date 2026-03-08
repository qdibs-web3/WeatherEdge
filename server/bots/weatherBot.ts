import { KalshiClient, KalshiMarket } from "../services/kalshiClient";
import { NwsService, NwsForecast, CITIES } from "../services/nwsService";
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
  if (type === "less" && cap !== null) return normCdf(cap, forecast, sigma);
  if (floor !== null && cap !== null) return normCdf(cap, forecast, sigma) - normCdf(floor, forecast, sigma);
  return 0.5;
}

const KALSHI_FEE_RATE = 0.07; // 7% taker fee on winnings

function calcEV(ourProb: number, priceCents: number): number {
  const fee = KALSHI_FEE_RATE * (100 - priceCents);
  return ourProb * (100 - priceCents - fee) - (1 - ourProb) * priceCents;
}

// ─── Time-Aware NWS Update Window Scheduler ───────────────────────────────────
//
// The NWS issues forecast updates at approximately:
//   06:00, 12:00, 18:00, and 00:00 local time for each city.
//
// The highest-edge window is the 45 minutes IMMEDIATELY AFTER each update.
// Outside of those windows the market has already repriced and the edge shrinks.
//
// This scheduler:
//   1. Runs a HIGH-FREQUENCY scan (every 2 minutes) for 45 min after each update.
//   2. Runs a LOW-FREQUENCY background scan (every 30 minutes) at all other times
//      to catch any late repricings or unexpected forecast revisions.
//
// NWS update hours (local time for each city timezone):
const NWS_UPDATE_HOURS_LOCAL = [6, 12, 18, 0]; // 6am, noon, 6pm, midnight
const HIGH_FREQ_WINDOW_MINUTES = 45;  // minutes after update to scan aggressively
const HIGH_FREQ_INTERVAL_MS   = 2 * 60 * 1000;   // 2 minutes
const LOW_FREQ_INTERVAL_MS    = 30 * 60 * 1000;  // 30 minutes

// Timezone offsets from UTC for each city (standard time; DST handled below)
const CITY_TIMEZONES: Record<string, string> = {
  NYC: "America/New_York",
  CHI: "America/Chicago",
  MIA: "America/New_York",
  LAX: "America/Los_Angeles",
  AUS: "America/Chicago",
  HOU: "America/Chicago",
  BOS: "America/New_York",
  SFO: "America/Los_Angeles",
  SEA: "America/Los_Angeles",
  OKC: "America/Chicago",
  LAS: "America/Los_Angeles",
  DCA: "America/New_York",
  ATL: "America/New_York",
  DAL: "America/Chicago",
  PHX: "America/Phoenix",
  MSP: "America/Chicago",
  SAT: "America/Chicago",
  SAN: "America/Chicago",
  PHI: "America/New_York",
  SJC: "America/Los_Angeles",
  JAX: "America/New_York",
  MSY: "America/Chicago",
  DEN: "America/Denver",
};

/**
 * Returns true if the current UTC time falls within the high-frequency
 * scan window for ANY of the enabled cities.
 */
function isInHighFreqWindow(enabledCities: string[]): boolean {
  const now = new Date();
  for (const cityCode of enabledCities) {
    const tz = CITY_TIMEZONES[cityCode] ?? "America/New_York";
    // Get local hour and minute for this city
    const localStr = now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false });
    const [hourStr, minStr] = localStr.split(":");
    const localHour = parseInt(hourStr, 10);
    const localMin  = parseInt(minStr, 10);

    for (const updateHour of NWS_UPDATE_HOURS_LOCAL) {
      // Minutes since this update hour
      let minutesSinceUpdate: number;
      if (localHour === updateHour) {
        minutesSinceUpdate = localMin;
      } else if (localHour === (updateHour + 1) % 24 && localMin < HIGH_FREQ_WINDOW_MINUTES) {
        minutesSinceUpdate = 60 + localMin;
      } else {
        continue;
      }
      if (minutesSinceUpdate <= HIGH_FREQ_WINDOW_MINUTES) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns minutes until the next NWS update window for any enabled city.
 * Used for logging so the user knows when the next high-edge window is.
 */
function minutesUntilNextWindow(enabledCities: string[]): number {
  const now = new Date();
  let minWait = Infinity;
  for (const cityCode of enabledCities) {
    const tz = CITY_TIMEZONES[cityCode] ?? "America/New_York";
    const localStr = now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false });
    const [hourStr, minStr] = localStr.split(":");
    const localHour = parseInt(hourStr, 10);
    const localMin  = parseInt(minStr, 10);
    const totalMinutes = localHour * 60 + localMin;

    for (const updateHour of NWS_UPDATE_HOURS_LOCAL) {
      const updateMinutes = updateHour * 60;
      let diff = updateMinutes - totalMinutes;
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
  ev: number;               // EV per contract (cents)
  totalExpectedProfit: number; // ev × contracts (cents) — used for ranking
  contracts: number;
  forecastTemp: number;
  strikeDesc: string;
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
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    console.log(`[WeatherBot] Starting for user ${this.config.userId} — time-aware scheduler active`);
    await this.log("info", "Bot started with time-aware NWS window scheduler");
    // Run first scan immediately, then schedule adaptively
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

  /**
   * Schedules the next scan based on whether we are in a high-frequency
   * NWS update window or a low-frequency background period.
   */
  private scheduleNext() {
    if (!this.running) return;
    if (this.scanTimer) clearTimeout(this.scanTimer);

    const inWindow = isInHighFreqWindow(this.config.enabledCities);
    const interval = inWindow ? HIGH_FREQ_INTERVAL_MS : LOW_FREQ_INTERVAL_MS;
    const modeLabel = inWindow ? "high-freq (2min)" : "low-freq (30min)";

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

  async scan(): Promise<TradeSignal[]> {
    this.lastScanAt = new Date();
    const signals: TradeSignal[] = [];
    const inWindow = isInHighFreqWindow(this.config.enabledCities);
    const windowType: "high-freq" | "low-freq" = inWindow ? "high-freq" : "low-freq";

    try {
      // 1. Fetch all NWS forecasts in parallel
      const forecasts = await this.nws.getAllForecasts();
      const forecastMap = new Map(forecasts.map((f) => [f.cityCode, f]));

      // 1b. Persist forecasts to DB so the Forecasts page can display them
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

      // 2. For each enabled city, find trading opportunities


      // 2. For each enabled city, find trading opportunities
      for (const cityCode of this.config.enabledCities) {
        const city = CITIES[cityCode];
        if (!city) continue;
        const forecast = forecastMap.get(cityCode);
        if (!forecast) continue;

        try {
          const citySignals = await this.analyzeCity(city, forecast, windowType);
          signals.push(...citySignals);
        } catch (err: any) {
          console.error(`[WeatherBot] Error analyzing ${cityCode}:`, err.message);
          this.errorsThisSession++;
        }
      }

      // 3. Sort by total expected profit (EV × contracts) descending
      // This prioritises trades that make the most money in dollar terms,
      // not just the highest per-contract edge.
      signals.sort((a, b) => b.totalExpectedProfit - a.totalExpectedProfit);
      this.lastSignals = signals;

      if (signals.length > 0) {
        const top = signals[0];
        const topProfitDollars = (top.totalExpectedProfit / 100).toFixed(2);
        console.log(`[WeatherBot] Scan complete [${windowType}] — ${signals.length} signal(s) found`);
        await this.log("signal", `Scan [${windowType}]: ${signals.length} signal(s) — best: ${top.cityName} ${top.side.toUpperCase()} ${top.strikeDesc} @ ${top.priceCents}¢ x${top.contracts} | EV: +${top.ev.toFixed(1)}¢/contract | Expected profit: +$${topProfitDollars}`);
      } else {
        console.log(`[WeatherBot] Scan complete [${windowType}] — no signals above threshold`);
      }

      // 4. Execute top signals if live trading
      if (!this.config.dryRun && signals.length > 0) {
        // Fetch live balance before executing any trades
        let availableBalanceCents = 0;
        try {
          const balanceData = await this.kalshi.getBalance();
          // Kalshi returns balance in cents
          availableBalanceCents = balanceData.balance ?? 0;
          console.log(`[WeatherBot] Live balance: $${(availableBalanceCents / 100).toFixed(2)} — ${signals.length} signal(s) queued`);
        } catch (err: any) {
          console.error(`[WeatherBot] Could not fetch balance, skipping trades:`, err.message);
          await this.log("error", `Balance check failed: ${err.message}`);
          // Skip all trades if we can't verify balance
          availableBalanceCents = 0;
        }

        // In high-freq windows, execute top 5; in low-freq, be more conservative (top 2)
        const maxTrades = inWindow ? 5 : 2;
        let spentCents = 0;

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
        // Paper mode — fetch balance for display but don't execute
        let paperBalance = 0;
        try { paperBalance = (await this.kalshi.getBalance()).balance ?? 0; } catch {}
        for (const signal of signals.slice(0, 3)) {
          const cost = signal.contracts * signal.priceCents;
          const expectedProfit = (signal.totalExpectedProfit / 100).toFixed(2);
          await this.log("signal", `[PAPER] Would trade: ${signal.cityName} ${signal.side.toUpperCase()} ${signal.strikeDesc} @ ${signal.priceCents}¢ x${signal.contracts} (cost $${(cost/100).toFixed(2)}) | EV: +${signal.ev.toFixed(1)}¢/contract | Expected profit: +$${expectedProfit} | Balance: $${(paperBalance/100).toFixed(2)}`);
        }
      }

      // 5. Persist scan result
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

    // In low-freq mode, use a higher EV threshold to only trade the very best setups
    const evThreshold = windowType === "high-freq"
      ? this.config.minEvCents
      : this.config.minEvCents * 1.5;

    const { markets } = await this.kalshi.getMarkets({
      series_ticker: city.seriesTicker,
      status: "open",
      limit: 20,
    });

    // Determine current local time in this city's timezone
    const cityTz = CITY_TIMEZONES[city.code] ?? "America/Chicago";
    const nowLocal = new Date(new Date().toLocaleString("en-US", { timeZone: cityTz }));
    const localHour = nowLocal.getHours();
    const localDateStr = nowLocal.toISOString().split("T")[0];

    for (const market of markets) {
      if ((market.open_interest ?? 0) < this.config.minLiquidity) continue;

      // Skip same-day markets after 6 PM local city time — outcome is nearly determined
      if (market.close_time) {
        const closeDate = market.close_time.split("T")[0];
        if (closeDate <= localDateStr && localHour >= 18) {
          continue;
        }
      }

      const floor = market.floor_strike ?? null;
      const cap   = market.cap_strike ?? null;
      const strikeType = market.strike_type ?? "between";

      const ourProb = probForStrike(forecast.highTemp, city.sigma, floor, cap, strikeType);

      // YES side
      const yesAsk = market.yes_ask;
      if (yesAsk > 0 && yesAsk <= this.config.maxPriceCents) {
        const ev = calcEV(ourProb, yesAsk);
        if (ev >= evThreshold) {
          const contracts = Math.max(1, Math.floor(this.config.flatBetDollars / (yesAsk / 100)));
          signals.push({
            cityCode: city.code, cityName: city.name, ticker: market.ticker,
            side: "yes", priceCents: yesAsk, ourProb, marketProb: yesAsk / 100,
            ev, totalExpectedProfit: ev * contracts, contracts, forecastTemp: forecast.highTemp,
            strikeDesc: this.strikeDesc(floor, cap, strikeType), windowType,
          });
        }
      }

      // NO side
      const noAsk  = market.no_ask;
      const noProb = 1 - ourProb;
      if (noAsk > 0 && noAsk <= this.config.maxPriceCents) {
        const ev = calcEV(noProb, noAsk);
        if (ev >= evThreshold) {
          const contracts = Math.max(1, Math.floor(this.config.flatBetDollars / (noAsk / 100)));
          signals.push({
            cityCode: city.code, cityName: city.name, ticker: market.ticker,
            side: "no", priceCents: noAsk, ourProb: noProb, marketProb: noAsk / 100,
            ev, totalExpectedProfit: ev * contracts, contracts, forecastTemp: forecast.highTemp,
            strikeDesc: this.strikeDesc(floor, cap, strikeType), windowType,
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
        side: signal.side,
        priceCents: signal.priceCents,
        contracts: signal.contracts,
        status: dbStatus,
        won: null,
        pnl: null,
        feeCents: null,
        settledAt: null,
      });


      const msg = `Trade placed [${signal.windowType}]: ${signal.cityName} ${signal.side.toUpperCase()} ${signal.strikeDesc} @ ${signal.priceCents}¢ x${signal.contracts} | EV: +${signal.ev.toFixed(1)}¢`;
      console.log(`[WeatherBot] ${msg}`);
      await this.log("trade", msg);

    } catch (err: any) {
      console.error(`[WeatherBot] Trade execution failed:`, err.message);
      this.errorsThisSession++;
      await this.log("error", `Trade execution failed: ${err.message}`);
    }
  }

  private async log(level: "info" | "signal" | "trade" | "error" | "warning", message: string) {
    try {
      await db.insertBotLog({ userId: this.config.userId, level, message });
    } catch (_) {
      // Non-fatal — don't crash the bot if logging fails
    }
  }
}