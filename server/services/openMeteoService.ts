/**
 * openMeteoService.ts — Multi-Model Ensemble Weather Forecast
 *
 * Fetches daily high temperature from three independent meteorological models:
 *   - best_match:   Open-Meteo's own weighted blend of the best available models
 *   - icon_global:  Germany's DWD ICON model — typically most accurate over North America
 *   - gem_seamless: Canada's GEM model — fully independent from the American GFS
 *
 * The consensus forecast (weighted average) is more accurate than any single model.
 * The spread (max − min across models) is used as a disagreement signal:
 *   - Spread < 3°F → models agree → normal confidence
 *   - Spread 3–6°F → models partially disagree → require higher edge
 *   - Spread > 6°F → models strongly disagree → skip trade (too uncertain)
 *
 * No API key required. Rate limit: ~10,000 calls/day on the free tier.
 */

import axios from "axios";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// Weights for consensus: ICON tends to outperform GFS for CONUS next-day highs
const MODEL_WEIGHTS = {
  best_match:   0.30,
  icon_global:  0.45,
  gem_seamless: 0.25,
};

export interface EnsembleForecast {
  bestMatch: number | null;   // Open-Meteo blended best
  icon: number | null;        // German DWD ICON model
  gem: number | null;         // Canadian GEM model
  consensus: number;          // Weighted average of available models
  spread: number;             // max − min across available models (uncertainty proxy)
  modelCount: number;         // How many models returned data
  fetchedAt: string;
}

// In-memory cache: key = `${lat},${lon},${date}`, value expires after 20 min
const cache = new Map<string, { data: EnsembleForecast; expiresAt: number }>();
const CACHE_TTL_MS = 20 * 60 * 1000;

/**
 * Fetch today's expected high temperature from three models for a given lat/lon.
 * Returns null if all models fail (non-fatal — caller should degrade gracefully).
 */
export async function getEnsembleForecast(
  lat: number,
  lon: number,
  date: string,     // YYYY-MM-DD in the city's local timezone
  timezone: string  // IANA timezone string
): Promise<EnsembleForecast | null> {
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${date}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Fetch all three models in parallel — fail gracefully per model
  const [bestMatchRes, iconRes, gemRes] = await Promise.allSettled([
    fetchModelTemp(lat, lon, timezone, date, "best_match"),
    fetchModelTemp(lat, lon, timezone, date, "icon_global"),
    fetchModelTemp(lat, lon, timezone, date, "gem_seamless"),
  ]);

  const bestMatch = bestMatchRes.status === "fulfilled" ? bestMatchRes.value : null;
  const icon      = iconRes.status      === "fulfilled" ? iconRes.value      : null;
  const gem       = gemRes.status       === "fulfilled" ? gemRes.value       : null;

  const available: { value: number; weight: number }[] = [];
  if (bestMatch !== null) available.push({ value: bestMatch, weight: MODEL_WEIGHTS.best_match });
  if (icon      !== null) available.push({ value: icon,      weight: MODEL_WEIGHTS.icon_global });
  if (gem       !== null) available.push({ value: gem,       weight: MODEL_WEIGHTS.gem_seamless });

  if (available.length === 0) return null;

  // Weighted average (re-normalize weights to sum to 1 with available models)
  const totalWeight = available.reduce((s, m) => s + m.weight, 0);
  const consensus   = available.reduce((s, m) => s + m.value * (m.weight / totalWeight), 0);

  const temps  = available.map((m) => m.value);
  const spread = Math.max(...temps) - Math.min(...temps);

  const result: EnsembleForecast = {
    bestMatch,
    icon,
    gem,
    consensus: Math.round(consensus * 10) / 10,
    spread:    Math.round(spread * 10) / 10,
    modelCount: available.length,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

async function fetchModelTemp(
  lat: number,
  lon: number,
  timezone: string,
  date: string,   // YYYY-MM-DD — pinned via start_date/end_date so UTC rollover can't shift the result
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

  const res = await axios.get(url.toString(), { timeout: 8000 });
  const maxTemps: number[] = res.data?.daily?.temperature_2m_max ?? [];
  if (!maxTemps.length || maxTemps[0] == null) {
    throw new Error(`No temperature data for model ${model}`);
  }
  return maxTemps[0];
}

export function clearEnsembleCache() {
  cache.clear();
}
