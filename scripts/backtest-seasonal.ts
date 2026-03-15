/**
 * backtest-seasonal.ts — Seasonal Bias Calibration via Kalshi Historical Markets
 *
 * Usage:
 *   npx tsx scripts/backtest-seasonal.ts
 *
 * What it does:
 *  1. Fetches all settled markets for each city series from Kalshi (authenticated)
 *  2. For each settled market: extracts result, strike_type, floor/cap, close_time (month)
 *  3. Computes actual YES win rates by:
 *       - Strike type (greater/less/between)
 *       - Month (Jan–Dec)
 *       - City
 *  4. Simulates what our model would have predicted (raw sigma model) at the market price
 *  5. Simulates what the seasonally-biased model would have predicted
 *  6. Computes EV per model and shows calibration quality
 *
 * Key insight: If YES win rate > market_price% for "greater" bets in March,
 * the seasonal bias (+2.5°F) is correct. If win rate < market_price%, bias is wrong direction.
 */

import "dotenv/config";
import { KalshiClient } from "../server/services/kalshiClient";
import { CITIES, CityConfig } from "../server/services/nwsService";

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
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

function probForStrike(
  forecast: number, sigma: number,
  floor: number | null, cap: number | null, type: string
): number {
  if (type === "greater" && floor !== null) return 1 - normCdf(floor, forecast, sigma);
  if (type === "less"    && cap  !== null) return normCdf(cap, forecast, sigma);
  if (floor !== null && cap !== null)      return normCdf(cap, forecast, sigma) - normCdf(floor, forecast, sigma);
  return 0.5;
}

// Seasonal NWS bias: how much NWS under/over-forecasts vs actual high temp
// Positive = NWS runs cold (actual was warmer than forecast) → add to forecast for probability calc
function seasonalBiasF(month: number): number {
  const bias: Record<number, number> = {
    1: -1.0, 2: -0.5, 3: 2.5, 4: 2.0, 5: 1.5,
    6: 0.5,  7: 0.0,  8: 0.0, 9: -0.5, 10: -1.0, 11: -1.5, 12: -1.0,
  };
  return bias[month] ?? 0;
}

// For a given strike, compute the "break-even" market-implied forecast temp
// i.e., what forecast temp would make our model agree with the market price
function impliedForecastTemp(
  marketPricePct: number, sigma: number,
  floor: number | null, cap: number | null, type: string
): number | null {
  if (type === "greater" && floor !== null) {
    // P(X > floor | mu, sigma) = marketPricePct
    // => normCdf(floor, mu, sigma) = 1 - marketPricePct
    // => (floor - mu)/sigma = normCdfInv(1 - marketPricePct)
    // Approximate inverse normal using bisection
    return bisect((mu) => probForStrike(mu, sigma, floor, null, "greater") - marketPricePct, floor - 4 * sigma, floor + 4 * sigma);
  }
  if (type === "less" && cap !== null) {
    return bisect((mu) => probForStrike(mu, sigma, null, cap, "less") - marketPricePct, cap - 4 * sigma, cap + 4 * sigma);
  }
  return null;
}

function bisect(f: (x: number) => number, lo: number, hi: number, iters = 40): number {
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ── Fetch settled markets for a series ───────────────────────────────────────

async function fetchSettledMarkets(seriesTicker: string): Promise<any[]> {
  const markets: any[] = [];
  let cursor: string | undefined;
  let page = 0;

  do {
    try {
      const res: any = await kalshi.getMarkets({
        series_ticker: seriesTicker,
        status: "settled",
        limit: 100,
        cursor,
      });
      const batch = res.markets ?? [];
      markets.push(...batch);
      cursor = res.cursor;
      page++;
      // Rate limit protection
      if (page > 10) break; // Max 1000 markets per series
    } catch (e: any) {
      console.error(`  ⚠ Error fetching ${seriesTicker}: ${e.message}`);
      break;
    }
  } while (cursor);

  return markets;
}

// ── Accumulate stats ──────────────────────────────────────────────────────────

interface MarketStat {
  month: number;
  strikeType: string;
  floor: number | null;
  cap: number | null;
  result: "yes" | "no";
  lastPrice: number; // Market last_price (proxy for mid-price when traded)
  cityCode: string;
  ticker: string;
}

interface MonthTypeStats {
  total: number;
  yesWins: number;
  priceSum: number; // sum of market prices (to compute avg implied prob)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🔬 WeatherEdge Seasonal Bias Backtest\n");
  console.log("Fetching settled markets from Kalshi for all cities...\n");

  const allStats: MarketStat[] = [];

  for (const [code, city] of Object.entries(CITIES)) {
    process.stdout.write(`  Fetching ${code} (${city.seriesTicker})... `);
    const markets = await fetchSettledMarkets(city.seriesTicker);

    let parsed = 0;
    for (const m of markets) {
      if (!m.result || !m.close_time) continue;
      const month = new Date(m.close_time).getMonth() + 1;
      const strikeType = m.strike_type ?? "unknown";
      if (strikeType === "unknown") continue;

      allStats.push({
        month,
        strikeType,
        floor: m.floor_strike ?? null,
        cap: m.cap_strike ?? null,
        result: m.result as "yes" | "no",
        lastPrice: m.last_price ?? 50,
        cityCode: code,
        ticker: m.ticker,
      });
      parsed++;
    }
    console.log(`${markets.length} markets → ${parsed} parseable`);
  }

  console.log(`\nTotal parseable settled markets: ${allStats.length}\n`);

  if (allStats.length === 0) {
    console.log("No settled market data found. This may mean:");
    console.log("  - The API key doesn't have access to settled market results");
    console.log("  - The series tickers are wrong");
    console.log("  - Kalshi doesn't expose result on public market endpoint");
    return;
  }

  // ── Analysis 1: YES win rate by strike type and month ──────────────────────
  console.log("━".repeat(80));
  console.log("ANALYSIS 1 — YES Win Rate by Strike Type × Month");
  console.log("━".repeat(80));
  console.log("(If NWS runs cold in spring: 'greater' YES win rate should be HIGH in Mar-May)");
  console.log("(If NWS runs cold in spring: 'less' YES win rate should be LOW in Mar-May)\n");

  const byTypeMonth: Record<string, MonthTypeStats> = {};

  for (const s of allStats) {
    if (s.strikeType === "between") continue; // Focus on directional bets
    const key = `${s.strikeType}|${s.month}`;
    if (!byTypeMonth[key]) byTypeMonth[key] = { total: 0, yesWins: 0, priceSum: 0 };
    byTypeMonth[key].total++;
    if (s.result === "yes") byTypeMonth[key].yesWins++;
    byTypeMonth[key].priceSum += s.lastPrice;
  }

  // Print table
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  for (const strikeType of ["greater", "less"]) {
    console.log(`\n${strikeType.toUpperCase()} bets (YES wins if temp ${strikeType === "greater" ? "above" : "below"} threshold):`);
    console.log(`${"Month".padEnd(6)} ${"N".padStart(5)} ${"Win%".padStart(6)} ${"AvgMkt%".padStart(8)} ${"Edge".padStart(6)} ${"Bias?".padStart(12)}`);
    console.log("-".repeat(50));

    for (let m = 1; m <= 12; m++) {
      const key = `${strikeType}|${m}`;
      const st = byTypeMonth[key];
      if (!st || st.total < 3) {
        console.log(`${monthNames[m-1].padEnd(6)} ${"<3".padStart(5)}`);
        continue;
      }
      const winRate = st.yesWins / st.total;
      const avgMktPrice = st.priceSum / st.total / 100; // Convert cents to fraction
      const edge = winRate - avgMktPrice;
      const bias = seasonalBiasF(m);
      const biasNote = bias > 0 ? `+${bias}°F (warm adj)` : bias < 0 ? `${bias}°F (cold adj)` : "no adj";

      console.log(
        `${monthNames[m-1].padEnd(6)} ${st.total.toString().padStart(5)} ` +
        `${(winRate * 100).toFixed(1).padStart(6)}% ` +
        `${(avgMktPrice * 100).toFixed(1).padStart(7)}% ` +
        `${(edge * 100 >= 0 ? "+" : "")+(edge * 100).toFixed(1).padStart(5)}% ` +
        `  ${biasNote}`
      );
    }
  }

  // ── Analysis 2: Model EV comparison (raw vs seasonal-biased) ──────────────
  console.log("\n\n" + "━".repeat(80));
  console.log("ANALYSIS 2 — Model EV: Raw sigma vs Seasonally-biased sigma");
  console.log("━".repeat(80));
  console.log("Metric: EV = (our_prob - market_price) per contract (positive = good edge)\n");

  // For each market, use the market's implied forecast temperature and then
  // apply the bias to see if we'd have gotten better calibration
  let rawEvSum = 0;
  let biasedEvSum = 0;
  let compareCount = 0;

  const monthlyComparison: Record<number, { rawEv: number; biasedEv: number; n: number }> = {};

  for (const s of allStats) {
    if (s.strikeType === "between") continue;
    const city = CITIES[s.cityCode];
    if (!city) continue;

    // Market price as probability
    const mktProb = s.lastPrice / 100;

    // Implied forecast from market price (what temp the market thinks)
    const impliedTemp = impliedForecastTemp(mktProb, city.sigma, s.floor, s.cap, s.strikeType);
    if (impliedTemp === null) continue;

    // Raw model: no bias — if we use market's implied temp, our prob = market prob
    // So instead, test: what if actual NWS forecast was impliedTemp, and we applied bias?
    // The bias shifts the effective forecast temperature
    const bias = seasonalBiasF(s.month);
    const biasedTemp = impliedTemp + bias;

    // Our probability with bias applied
    const biasedProb = probForStrike(biasedTemp, city.sigma, s.floor, s.cap, s.strikeType);

    // Actual outcome (1 = YES won, 0 = NO won)
    const outcome = s.result === "yes" ? 1 : 0;

    // EV relative to market: (our_prob - market_prob) * outcome_adjusted
    // More direct: EV = our_prob * 100 - market_price (in cents), then multiply by outcome
    // Simplified edge per trade = (our_prob - market_prob) when outcome = yes
    //   = (1 - our_prob) - (1 - market_prob) when outcome = no
    // Actual realized EV vs raw: (outcome - mktProb) — this is market-neutral
    // Vs biased: (outcome - biasedProb)
    // Lower residual error = better calibration

    const rawResidual    = Math.abs(outcome - mktProb);       // raw model = market price
    const biasedResidual = Math.abs(outcome - biasedProb);   // our biased model

    rawEvSum    += rawResidual;
    biasedEvSum += biasedResidual;
    compareCount++;

    if (!monthlyComparison[s.month]) monthlyComparison[s.month] = { rawEv: 0, biasedEv: 0, n: 0 };
    monthlyComparison[s.month].rawEv    += rawResidual;
    monthlyComparison[s.month].biasedEv += biasedResidual;
    monthlyComparison[s.month].n++;
  }

  if (compareCount > 0) {
    console.log(`Compared ${compareCount} directional markets\n`);
    console.log(`${"Month".padEnd(6)} ${"N".padStart(5)} ${"RawErr".padStart(8)} ${"BiasErr".padStart(9)} ${"Δ(better?)".padStart(12)}`);
    console.log("-".repeat(45));

    for (let m = 1; m <= 12; m++) {
      const c = monthlyComparison[m];
      if (!c || c.n < 3) continue;
      const rawMean    = c.rawEv    / c.n;
      const biasedMean = c.biasedEv / c.n;
      const delta = rawMean - biasedMean; // positive = biased model is better (lower error)
      const better = delta > 0.005 ? "✅ Bias helps" : delta < -0.005 ? "❌ Bias hurts" : "≈ neutral";
      console.log(
        `${monthNames[m-1].padEnd(6)} ${c.n.toString().padStart(5)} ` +
        `${rawMean.toFixed(3).padStart(8)} ${biasedMean.toFixed(3).padStart(9)} ` +
        `  ${(delta >= 0 ? "+" : "") + delta.toFixed(3).padStart(6)} ${better}`
      );
    }

    console.log("\nOverall:");
    const rawMeanErr    = rawEvSum    / compareCount;
    const biasedMeanErr = biasedEvSum / compareCount;
    const totalDelta = rawMeanErr - biasedMeanErr;
    console.log(`  Raw model mean abs error:    ${rawMeanErr.toFixed(4)}`);
    console.log(`  Biased model mean abs error: ${biasedMeanErr.toFixed(4)}`);
    console.log(`  Improvement from bias:       ${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(4)} (${totalDelta > 0 ? "✅ bias helps overall" : "❌ bias hurts overall"})`);
  }

  // ── Analysis 3: City-level calibration ────────────────────────────────────
  console.log("\n\n" + "━".repeat(80));
  console.log("ANALYSIS 3 — Per-City YES Win Rate (overall, all months)");
  console.log("━".repeat(80));
  console.log("(Lower win rate on 'less' = market often resolved YES for 'greater' = warm bias)\n");

  const cityStats: Record<string, Record<string, { total: number; yesWins: number }>> = {};

  for (const s of allStats) {
    if (s.strikeType === "between") continue;
    if (!cityStats[s.cityCode]) cityStats[s.cityCode] = {};
    if (!cityStats[s.cityCode][s.strikeType]) cityStats[s.cityCode][s.strikeType] = { total: 0, yesWins: 0 };
    cityStats[s.cityCode][s.strikeType].total++;
    if (s.result === "yes") cityStats[s.cityCode][s.strikeType].yesWins++;
  }

  console.log(`${"City".padEnd(6)} ${"sigma".padStart(6)} ${"Greater YES%".padStart(13)} ${"Less YES%".padStart(10)} ${"Signal".padStart(20)}`);
  console.log("-".repeat(60));

  for (const [code, types] of Object.entries(cityStats)) {
    const city = CITIES[code];
    const g = types["greater"];
    const l = types["less"];
    const gPct = g ? (g.yesWins / g.total * 100).toFixed(1) + `% (${g.total})` : "n/a";
    const lPct = l ? (l.yesWins / l.total * 100).toFixed(1) + `% (${l.total})` : "n/a";

    // Signal: if "greater" win rate >> 50%, market underprices warm outcomes
    let signal = "";
    if (g && g.total >= 5) {
      const gWR = g.yesWins / g.total;
      if (gWR > 0.55) signal = "⬆ Runs warm";
      else if (gWR < 0.45) signal = "⬇ Runs cold";
    }

    console.log(
      `${code.padEnd(6)} ${(city?.sigma ?? "?").toString().padStart(6)} ` +
      `${gPct.padStart(13)} ${lPct.padStart(10)} ${signal.padStart(20)}`
    );
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  console.log("\n\n" + "━".repeat(80));
  console.log("RECOMMENDATIONS");
  console.log("━".repeat(80));
  console.log(`
Based on the analysis above:

1. SEASONAL BIAS VALIDATION
   - If 'greater' YES win rate > avg market price in Mar-May → NWS runs cold in spring ✅
   - If 'less' YES win rate < avg market price in Mar-May → confirms spring warm bias ✅
   - The current bias values (+2.5°F Mar, +2.0°F Apr, +1.5°F May) are validated
     if the data shows those months outperform for "greater" bets.

2. SIGMA CALIBRATION
   - Cities marked "⬆ Runs warm" should trade MORE 'greater' bets (NWS under-forecasts)
   - Cities marked "⬇ Runs cold" should trade MORE 'less' bets (NWS over-forecasts)
   - If a city's actual win rate is far from 50%, its sigma may need adjustment

3. STRIKE TYPE PREFERENCE (current month: March)
   - March bias = +2.5°F → prefer 'greater' (YES above threshold) bets
   - Avoid 'less' bets in March unless market price is heavily discounted

4. MINIMUM EDGE THRESHOLD
   - Only trade when our_prob > market_price + 0.07 (7% edge minimum after fees)
   - Fee structure: 7% of gross winnings, so break-even ≈ 48.2¢
`);
}

main().catch(console.error);
