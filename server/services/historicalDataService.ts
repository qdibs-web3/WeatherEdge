/**
 * historicalDataService.ts
 * Handles historical data collection: forecast accuracy tracking and Kalshi market history.
 */
import axios from "axios";
import * as db from "../db";
import { CITIES } from "./nwsService";
import type { KalshiClient } from "./kalshiClient";

const OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

// ─── Table Creation ────────────────────────────────────────────────────────────

export async function ensureHistoricalTables(): Promise<void> {
  // Add forecast_date column to forecast_cache_v2 if it doesn't already exist.
  // This lets the nightly job match actual temps back to the forecast that was made.
  for (const ddl of [
    `ALTER TABLE forecast_cache_v2 ADD COLUMN IF NOT EXISTS forecast_date VARCHAR(20) NULL`,
    `ALTER TABLE forecast_cache_v2 ADD COLUMN IF NOT EXISTS tomorrow_high DECIMAL(5,1) NULL`,
    `ALTER TABLE forecast_cache_v2 ADD COLUMN IF NOT EXISTS tomorrow_forecast_date VARCHAR(20) NULL`,
  ]) {
    try { await db.execRaw(ddl); } catch (_) { /* IF NOT EXISTS not supported — ignore */ }
  }

  await db.execRaw(`
    CREATE TABLE IF NOT EXISTS forecast_accuracy_v2 (
      id INT PRIMARY KEY AUTO_INCREMENT,
      city_code VARCHAR(10) NOT NULL,
      city_name VARCHAR(100) NOT NULL,
      forecast_date VARCHAR(20) NOT NULL,
      nws_forecast DECIMAL(5,1),
      ensemble_forecast DECIMAL(5,1),
      actual_high DECIMAL(5,1) NOT NULL,
      error_nws DECIMAL(5,1),
      error_ensemble DECIMAL(5,1),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE KEY uq_fa_city_date (city_code, forecast_date)
    )
  `);

  await db.execRaw(`
    CREATE TABLE IF NOT EXISTS kalshi_market_history (
      id INT PRIMARY KEY AUTO_INCREMENT,
      ticker VARCHAR(100) NOT NULL,
      series_ticker VARCHAR(50),
      city_code VARCHAR(10),
      strike_type VARCHAR(20),
      floor_strike DECIMAL(6,1),
      cap_strike DECIMAL(6,1),
      settlement_result VARCHAR(5),
      final_price_cents INT,
      close_time VARCHAR(50),
      fetched_at TIMESTAMP DEFAULT NOW(),
      UNIQUE KEY uq_kmh_ticker (ticker)
    )
  `);
}

// ─── Fetch Actual Temp from Open-Meteo Archive ─────────────────────────────────

export async function fetchActualTemp(
  lat: number,
  lon: number,
  date: string,
  timezone: string
): Promise<number | null> {
  try {
    const res = await axios.get(OPEN_METEO_ARCHIVE, {
      params: {
        latitude: lat,
        longitude: lon,
        start_date: date,
        end_date: date,
        daily: "temperature_2m_max",
        temperature_unit: "fahrenheit",
        timezone,
      },
      timeout: 15000,
    });

    const daily = res.data?.daily;
    if (!daily?.temperature_2m_max?.length) return null;
    const val = daily.temperature_2m_max[0];
    if (val == null) return null;
    return Math.round(val * 10) / 10;
  } catch (err: any) {
    console.error(`[Historical] fetchActualTemp failed for ${date} (${lat},${lon}):`, err.message);
    return null;
  }
}

// ─── Backfill Forecast Accuracy ────────────────────────────────────────────────

export async function backfillForecastAccuracy(daysBack: number): Promise<void> {
  console.log(`[Historical] Starting forecast accuracy backfill for ${daysBack} days`);

  const cityList = Object.values(CITIES);
  const today = new Date();

  for (const city of cityList) {
    console.log(`[Historical] Backfilling forecast accuracy for ${city.name} (${city.code})...`);

    for (let d = 1; d <= daysBack; d++) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const dateStr = date.toISOString().split("T")[0];

      try {
        // Look up forecast from forecast_cache_v2
        const forecastRows = await db.queryRaw(
          `SELECT * FROM forecast_cache_v2 WHERE city_code = ? AND forecast_date = ? ORDER BY fetched_at DESC LIMIT 1`,
          [city.code, dateStr]
        );
        const forecastRow = forecastRows[0] ?? null;

        const nwsForecast: number | null =
          forecastRow?.forecast_high != null ? Number(forecastRow.forecast_high) : null;
        const ensembleForecast: number | null =
          forecastRow?.ensemble_high != null ? Number(forecastRow.ensemble_high) : null;

        // Fetch actual temp from Open-Meteo
        const actualHigh = await fetchActualTemp(city.lat, city.lon, dateStr, city.timezone);
        if (actualHigh == null) continue;

        const errorNws =
          nwsForecast != null ? Math.round((actualHigh - nwsForecast) * 10) / 10 : null;
        const errorEnsemble =
          ensembleForecast != null
            ? Math.round((actualHigh - ensembleForecast) * 10) / 10
            : null;

        await db.execRaw(
          `INSERT INTO forecast_accuracy_v2
             (city_code, city_name, forecast_date, nws_forecast, ensemble_forecast, actual_high, error_nws, error_ensemble)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             nws_forecast = VALUES(nws_forecast),
             ensemble_forecast = VALUES(ensemble_forecast),
             actual_high = VALUES(actual_high),
             error_nws = VALUES(error_nws),
             error_ensemble = VALUES(error_ensemble)`,
          [
            city.code,
            city.name,
            dateStr,
            nwsForecast,
            ensembleForecast,
            actualHigh,
            errorNws,
            errorEnsemble,
          ]
        );
      } catch (err: any) {
        console.error(
          `[Historical] Error backfilling ${city.code} on ${dateStr}:`,
          err.message
        );
      }
    }

    // 200ms delay between cities to avoid overwhelming Open-Meteo
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[Historical] Forecast accuracy backfill complete`);
}

// ─── Backfill Kalshi History ───────────────────────────────────────────────────

export async function backfillKalshiHistory(kalshi: KalshiClient): Promise<void> {
  console.log(`[Historical] Starting Kalshi market history backfill`);

  const cityList = Object.values(CITIES);

  for (const city of cityList) {
    const seriesTicker = city.seriesTicker;
    console.log(`[Historical] Fetching settled markets for ${city.name} (${seriesTicker})...`);

    let cursor: string | undefined = undefined;
    let page = 0;
    let totalFetched = 0;

    try {
      do {
        const result = await kalshi.getSettledMarkets({
          series_ticker: seriesTicker,
          limit: 100,
          cursor,
        });

        const markets = result.markets ?? [];
        cursor = result.cursor;
        page++;

        for (const market of markets) {
          try {
            const settlementResult: string | null = (market as any).result ?? null;
            const finalPrice: number | null =
              market.last_price != null ? Number(market.last_price) : null;

            await db.execRaw(
              `INSERT INTO kalshi_market_history
                 (ticker, series_ticker, city_code, strike_type, floor_strike, cap_strike, settlement_result, final_price_cents, close_time)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE
                 settlement_result = VALUES(settlement_result),
                 final_price_cents = VALUES(final_price_cents),
                 fetched_at = NOW()`,
              [
                market.ticker,
                seriesTicker,
                city.code,
                market.strike_type ?? null,
                market.floor_strike ?? null,
                market.cap_strike ?? null,
                settlementResult,
                finalPrice,
                market.close_time ?? null,
              ]
            );
            totalFetched++;
          } catch (innerErr: any) {
            console.error(
              `[Historical] Error storing market ${market.ticker}:`,
              innerErr.message
            );
          }
        }

        if (markets.length === 0) break;
      } while (cursor && page < 20);

      console.log(
        `[Historical] ${city.name}: stored ${totalFetched} settled markets (${page} page(s))`
      );
    } catch (err: any) {
      console.error(
        `[Historical] Error fetching settled markets for ${seriesTicker}:`,
        err.message
      );
    }
  }

  console.log(`[Historical] Kalshi market history backfill complete`);
}

// ─── Nightly Accuracy Job ─────────────────────────────────────────────────────

export async function runNightlyAccuracyJob(): Promise<void> {
  console.log(`[Historical] Running nightly accuracy job`);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split("T")[0];

  const cityList = Object.values(CITIES);

  for (const city of cityList) {
    try {
      // Look up yesterday's forecast from forecast_cache_v2
      const forecastRows = await db.queryRaw(
        `SELECT * FROM forecast_cache_v2 WHERE city_code = ? AND forecast_date = ? ORDER BY fetched_at DESC LIMIT 1`,
        [city.code, dateStr]
      );
      const forecastRow = forecastRows[0] ?? null;

      const nwsForecast: number | null =
        forecastRow?.forecast_high != null ? Number(forecastRow.forecast_high) : null;
      const ensembleForecast: number | null =
        forecastRow?.ensemble_high != null ? Number(forecastRow.ensemble_high) : null;

      // Fetch actual temp from Open-Meteo archive
      const actualHigh = await fetchActualTemp(city.lat, city.lon, dateStr, city.timezone);
      if (actualHigh == null) {
        console.warn(`[Historical] No actual temp for ${city.code} on ${dateStr}`);
        continue;
      }

      const errorNws =
        nwsForecast != null ? Math.round((actualHigh - nwsForecast) * 10) / 10 : null;
      const errorEnsemble =
        ensembleForecast != null
          ? Math.round((actualHigh - ensembleForecast) * 10) / 10
          : null;

      await db.execRaw(
        `INSERT INTO forecast_accuracy_v2
           (city_code, city_name, forecast_date, nws_forecast, ensemble_forecast, actual_high, error_nws, error_ensemble)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           nws_forecast = VALUES(nws_forecast),
           ensemble_forecast = VALUES(ensemble_forecast),
           actual_high = VALUES(actual_high),
           error_nws = VALUES(error_nws),
           error_ensemble = VALUES(error_ensemble)`,
        [
          city.code,
          city.name,
          dateStr,
          nwsForecast,
          ensembleForecast,
          actualHigh,
          errorNws,
          errorEnsemble,
        ]
      );

      const hasNws = errorNws != null;
      const hasEns = errorEnsemble != null;
      if (hasNws || hasEns) {
        console.log(
          `[Historical] ${city.name} on ${dateStr}: actual=${actualHigh}°F | ` +
          `nwsErr=${hasNws ? errorNws + "°F" : "—"} ensErr=${hasEns ? errorEnsemble + "°F" : "—"}`
        );
      } else {
        console.log(
          `[Historical] ${city.name} on ${dateStr}: actual=${actualHigh}°F | ` +
          `no cached forecast for this date yet (will populate after next bot scan)`
        );
      }
    } catch (err: any) {
      console.error(`[Historical] Nightly job error for ${city.code}:`, err.message);
    }

    // Small delay between cities
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`[Historical] Nightly accuracy job complete for ${dateStr}`);
}
