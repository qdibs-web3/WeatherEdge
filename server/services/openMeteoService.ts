/**
 * openMeteoService.ts — Multi-Model Ensemble Weather Forecast
 *
 * Fetches daily high temperature from four independent meteorological models
 * via the Open-Meteo API (free, no key required, ~10,000 calls/day).
 *
 * Models (all confirmed working on the Open-Meteo free tier):
 *   best_match   — Open-Meteo's own weighted blend of the best available models
 *   gfs_seamless — NOAA GFS, the primary US NWP model
 *   icon_global  — German DWD ICON, proven global coverage
 *   gem_seamless — Canadian GEM, independent lineage from GFS
 *
 * NOTE: ecmwf_ifs04 was removed. While it exists on the free tier, it proved
 * unreliable in practice and was causing all-model failures due to error responses
 * that coincided with the other model calls. Stick to the four proven models.
 *
 * Consensus = weighted average of available models (re-normalizes if any fail).
 * Spread    = max − min across models = uncertainty proxy used by weatherBot.
 */

import axios from "axios";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// Four proven free-tier models with equal-ish weights
const MODEL_WEIGHTS: Record<string, number> = {
  best_match:   0.30,   // Open-Meteo proven blend — guaranteed fallback
  gfs_seamless: 0.30,   // NOAA GFS — primary US NWP model
  icon_global:  0.25,   // DWD ICON — solid global coverage
  gem_seamless: 0.15,   // Canadian GEM — independent lineage
};

export interface EnsembleForecast {
  bestMatch:  number | null;   // Open-Meteo proven blend
  gfs:        number | null;   // NOAA GFS
  icon:       number | null;   // German DWD ICON
  gem:        number | null;   // Canadian GEM
  consensus:  number;          // Weighted average of available models
  spread:     number;          // max − min across models (uncertainty proxy)
  modelCount: number;          // How many models returned data
  isDay2:     boolean;         // Informational: whether this is a day+2 forecast
  fetchedAt:  string;
}

// In-memory cache: key = `${lat},${lon},${date}`, expires after 20 min
const cache = new Map<string, { data: EnsembleForecast; expiresAt: number }>();
const CACHE_TTL_MS = 20 * 60 * 1000;

/**
 * Fetch ensemble forecast for a given lat/lon and date.
 * Returns null only if ALL models fail — caller degrades to NWS-only.
 */
export async function getEnsembleForecast(
  lat: number,
  lon: number,
  date: string,      // YYYY-MM-DD in the city's local timezone
  timezone: string,  // IANA timezone string
  isDay2 = false
): Promise<EnsembleForecast | null> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${date}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const modelIds = Object.keys(MODEL_WEIGHTS);

  // Fetch all models in parallel — each fails independently
  const results = await Promise.allSettled(
    modelIds.map((id) => fetchModelTemp(lat, lon, timezone, date, id))
  );

  const modelValues: Record<string, number | null> = {};
  modelIds.forEach((id, i) => {
    modelValues[id] = results[i].status === "fulfilled" ? (results[i] as PromiseFulfilledResult<number>).value : null;
  });

  // Log any failures
  modelIds.forEach((id, i) => {
    if (results[i].status === "rejected") {
      const reason = (results[i] as PromiseRejectedResult).reason;
      console.warn(`[Ensemble] ${id} failed for ${lat.toFixed(2)},${lon.toFixed(2)} ${date}: ${reason?.message ?? reason}`);
    }
  });

  // Build weighted consensus from available models
  const available: { value: number; weight: number }[] = [];
  for (const [id, weight] of Object.entries(MODEL_WEIGHTS)) {
    const val = modelValues[id];
    if (val !== null && val !== undefined) available.push({ value: val, weight });
  }

  if (available.length === 0) {
    console.error(`[Ensemble] ALL models failed for ${lat.toFixed(2)},${lon.toFixed(2)} on ${date} — returning null`);
    return null;
  }

  const totalWeight = available.reduce((s, m) => s + m.weight, 0);
  const consensus   = available.reduce((s, m) => s + m.value * (m.weight / totalWeight), 0);
  const temps       = available.map((m) => m.value);
  const spread      = Math.max(...temps) - Math.min(...temps);

  const result: EnsembleForecast = {
    bestMatch:  modelValues["best_match"]   ?? null,
    gfs:        modelValues["gfs_seamless"] ?? null,
    icon:       modelValues["icon_global"]  ?? null,
    gem:        modelValues["gem_seamless"] ?? null,
    consensus:  Math.round(consensus * 10) / 10,
    spread:     Math.round(spread    * 10) / 10,
    modelCount: available.length,
    isDay2,
    fetchedAt:  new Date().toISOString(),
  };

  console.log(`[Ensemble] ${lat.toFixed(2)},${lon.toFixed(2)} ${date}: ${available.length}/4 models → consensus ${result.consensus}°F spread ${result.spread}°F`);

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

async function fetchModelTemp(
  lat: number,
  lon: number,
  timezone: string,
  date: string,
  model: string
): Promise<number> {
  const url = new URL(OPEN_METEO_BASE);
  url.searchParams.set("latitude",         lat.toString());
  url.searchParams.set("longitude",        lon.toString());
  url.searchParams.set("daily",            "temperature_2m_max");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone",         timezone);
  url.searchParams.set("start_date",       date);
  url.searchParams.set("end_date",         date);
  url.searchParams.set("models",           model);

  const res = await axios.get(url.toString(), { timeout: 10000 });

  // Open-Meteo sometimes returns HTTP 200 with an error body
  if (res.data?.error) {
    throw new Error(`API error: ${res.data.reason ?? "unknown"}`);
  }

  const maxTemps: number[] = res.data?.daily?.temperature_2m_max ?? [];
  if (!maxTemps.length || maxTemps[0] == null) {
    throw new Error(`No temperature_2m_max data returned`);
  }
  return maxTemps[0];
}

export function clearEnsembleCache() {
  cache.clear();
}
