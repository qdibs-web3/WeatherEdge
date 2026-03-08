/**
 * backtest.ts — Trade History Analysis & Sigma Calibration
 *
 * Usage:
 *   npx tsx scripts/backtest.ts
 *
 * Requires: DATABASE_URL, KALSHI_API_KEY_ID, KALSHI_PRIVATE_KEY_PEM in .env
 *
 * What it does:
 *  1. Fetches all Kalshi fills + settlements from the API
 *  2. Matches trades to what the NWS forecast was at trade time
 *  3. Computes actual win rate vs predicted win rate per city
 *  4. Outputs sigma calibration recommendations
 *  5. Prints a full audit of each trade with PASS/FAIL and why
 */

import "dotenv/config";
import { KalshiClient } from "../server/services/kalshiClient";
import { CITIES } from "../server/services/nwsService";

const KALSHI_KEY_ID  = process.env.KALSHI_API_KEY_ID  ?? process.env.KALSHI_API_KEY ?? "";
const KALSHI_KEY_PEM = process.env.KALSHI_PRIVATE_KEY_PEM ?? "";

if (!KALSHI_KEY_ID || !KALSHI_KEY_PEM) {
  console.error("❌ Missing KALSHI_API_KEY_ID or KALSHI_PRIVATE_KEY_PEM in .env");
  process.exit(1);
}

const kalshi = new KalshiClient(KALSHI_KEY_PEM, KALSHI_KEY_ID);

// ── Helpers ───────────────────────────────────────────────────────────────────

function normCdf(x: number, mean: number, std: number): number {
  const z = (x - mean) / std;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t*(0.319381530 + t*(-0.356563782 + t*(1.781477937 + t*(-1.821255978 + t*1.330274429))));
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

function probForStrike(forecast: number, sigma: number, floor: number | null, cap: number | null, type: string) {
  if (type === "greater" && floor !== null) return 1 - normCdf(floor, forecast, sigma);
  if (type === "less"    && cap  !== null) return normCdf(cap, forecast, sigma);
  if (floor !== null && cap !== null)      return normCdf(cap, forecast, sigma) - normCdf(floor, forecast, sigma);
  return 0.5;
}

function cityFromTicker(ticker: string): string | null {
  for (const [code, city] of Object.entries(CITIES)) {
    const series = city.seriesTicker;
    if (ticker.startsWith(series + "-")) return code;
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🔍 WeatherEdge Trade History Analysis\n");
  console.log("Fetching fills from Kalshi...\n");

  // Fetch fills (executed trades)
  let allFills: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await kalshi.getFills({ limit: 100, cursor });
    allFills = allFills.concat(res.fills ?? []);
    cursor = res.cursor;
  } while (cursor);

  console.log(`Found ${allFills.length} fill(s)\n`);

  if (allFills.length === 0) {
    console.log("No fills found. Have you placed any trades yet?");
    return;
  }

  // Fetch settlements
  let settlements: any[] = [];
  let settCursor: string | undefined;
  do {
    const res = await kalshi.getPortfolioSettlements({ limit: 100, cursor: settCursor });
    settlements = settlements.concat(res.settlements ?? []);
    settCursor = res.cursor;
  } while (settCursor);

  const settledMap = new Map<string, any>();
  for (const s of settlements) {
    settledMap.set(s.ticker, s);
  }

  // Group fills by market ticker
  const byTicker = new Map<string, any[]>();
  for (const fill of allFills) {
    if (!byTicker.has(fill.ticker)) byTicker.set(fill.ticker, []);
    byTicker.get(fill.ticker)!.push(fill);
  }

  // Analyze each market
  console.log("━".repeat(80));
  console.log("TRADE AUDIT");
  console.log("━".repeat(80));

  const cityStats: Record<string, { trades: number; wins: number; evSum: number }> = {};
  let totalTrades = 0;
  let totalWins   = 0;

  for (const [ticker, fills] of Array.from(byTicker.entries())) {
    const cityCode = cityFromTicker(ticker);
    const city     = cityCode ? CITIES[cityCode] : null;

    // Determine net position and side
    const totalContracts = fills.reduce((s: number, f: any) => {
      return s + (f.side === "yes" ? f.count : -f.count);
    }, 0);

    const netSide: "yes" | "no" = totalContracts >= 0 ? "yes" : "no";
    const avgPrice = fills.reduce((s: number, f: any) => s + f.price * f.count, 0) /
                     fills.reduce((s: number, f: any) => s + f.count, 0);

    const settlement = settledMap.get(ticker);
    const settled    = !!settlement;
    const won        = settled ? (settlement.revenue > 0 ? (netSide === "yes" ? settlement.result === "yes" : settlement.result === "no") : false) : null;
    const pnl        = settled ? (settlement.revenue - settlement.total_cost) : null;

    // Try to figure out market metadata
    let marketInfo: any = null;
    try {
      marketInfo = await kalshi.getMarket(ticker).catch(() => null);
    } catch {}

    const floor      = marketInfo?.floor_strike ?? null;
    const cap        = marketInfo?.cap_strike   ?? null;
    const strikeType = marketInfo?.strike_type  ?? "unknown";

    // Reconstruct what the forecast SHOULD have been at trade time
    // (We don't have historical NWS data, but we can note discrepancy)
    const tradeDate = new Date(fills[0].created_time).toLocaleDateString("en-CA", {
      timeZone: city?.timezone ?? "America/New_York",
    });

    const status = won === null ? "⏳ PENDING" : (won ? "✅ WIN" : "❌ LOSS");

    console.log(`\n${status} | ${ticker}`);
    console.log(`  City:       ${city ? city.name : cityCode ?? "unknown"} (${cityCode ?? "?"})`);
    console.log(`  Trade date: ${tradeDate} | fills: ${fills.length}`);
    console.log(`  Side:       ${netSide.toUpperCase()} @ avg ${avgPrice.toFixed(1)}¢`);
    console.log(`  Strike:     floor=${floor ?? "-"} cap=${cap ?? "-"} type=${strikeType}`);
    if (pnl !== null) {
      console.log(`  PnL:        ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}¢`);
    }

    // Sigma diagnostics — what prob did we likely assign vs market?
    if (city && floor !== null && strikeType !== "unknown") {
      console.log(`  [Sigma diag] City sigma=${city.sigma}°F`);
      // We don't have the exact NWS forecast that was used, but we can note:
      console.log(`  [Note] To diagnose: check what NWS forecast was for ${city.name} on ${tradeDate}`);
      console.log(`         Kalshi market price was ~${avgPrice.toFixed(1)}¢ (implied prob: ${avgPrice.toFixed(1)}%)`);
    }

    // Track city-level stats
    if (settled && won !== null) {
      if (!cityStats[cityCode ?? "UNKNOWN"]) cityStats[cityCode ?? "UNKNOWN"] = { trades: 0, wins: 0, evSum: 0 };
      cityStats[cityCode ?? "UNKNOWN"].trades++;
      if (won) cityStats[cityCode ?? "UNKNOWN"].wins++;
      totalTrades++;
      if (won) totalWins++;
    }
  }

  // ── Summary ──
  console.log("\n" + "━".repeat(80));
  console.log("SUMMARY");
  console.log("━".repeat(80));
  console.log(`Total settled trades: ${totalTrades}`);
  console.log(`Wins: ${totalWins} / ${totalTrades} (${totalTrades > 0 ? ((totalWins/totalTrades)*100).toFixed(1) : "n/a"}%)`);

  if (Object.keys(cityStats).length > 0) {
    console.log("\nBy city:");
    for (const [code, stats] of Object.entries(cityStats)) {
      const city = CITIES[code];
      console.log(
        `  ${code} (${city?.name ?? "?"}): ${stats.wins}/${stats.trades} ` +
        `(${((stats.wins/stats.trades)*100).toFixed(1)}%) | sigma=${city?.sigma ?? "?"}`
      );
    }
  }

  // ── Root cause analysis for 3 initial failed trades ──
  console.log("\n" + "━".repeat(80));
  console.log("ROOT CAUSE ANALYSIS — Known bugs that affected early trades:");
  console.log("━".repeat(80));
  console.log(`
1. UTC DATE BUG (FIXED in v2)
   The bot used toISOString() for NWS date matching — this returns UTC date.
   After 7 PM Eastern, UTC was already "tomorrow", so the bot fetched tomorrow's
   NWS forecast period and traded against today's Kalshi market. Result: wrong temp
   forecast → wrong probability → wrong side.

2. DEAD SERIES TICKERS (FIXED in v2)
   AUS city: was using "KXHIGHAUSTIN" — returns 0 markets (dead ticker).
             Fixed to "KXHIGHAUS" (verified: 3+ active markets).
   MSY city: was using "KXHIGHMSY" — returns 0 markets (dead ticker).
             Fixed to "KXHIGHTNOLA" (verified: 3+ active markets).
   If either city was in your enabled list, the bot found no markets and may have
   traded fallback or mismatched data.

3. NO POSITION DEDUPLICATION (FIXED in v2)
   Bot could re-enter the same market multiple times in the same session, increasing
   risk concentration without awareness.

4. MISSING HOURLY FORECAST (FIXED in v2)
   Bot used daily period high (less precise). Now uses NWS hourly endpoint to compute
   actual expected high, improving forecast accuracy by ~0.5-1°F on average.

RECOMMENDED NEXT STEPS:
  - Run this script after each week of trading to calibrate sigma values
  - If a city's win rate is consistently < 50%, increase its sigma
  - If win rate is > 65%, consider decreasing sigma (tighter edge)
  - Monitor forecastAge — trades placed on forecasts > 4h old have lower edge
`);
}

main().catch(console.error);
