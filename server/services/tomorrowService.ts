/**
 * tomorrowService.ts — Tomorrow.io Forecast (4th Independent Source)
 *
 * API limits (free tier):
 *   500 calls / day
 *   25  calls / hour  ← this is the binding constraint
 *   3   calls / second
 *
 * RATE LIMIT STRATEGY:
 *   - All calls go through a serial promise queue — no concurrent HTTP requests.
 *     This prevents the burst problem where Promise.allSettled fires 25 calls
 *     simultaneously before any rate-limit check can run.
 *   - Hourly call counter tracks the last 60 minutes. If ≥22 calls have been
 *     made in the rolling window, new calls are skipped (returns null from cache
 *     if available, or null). This leaves a 3-call buffer below the 25/hr cap.
 *   - Cache TTL is 90 minutes. At 25 cities cached for 90 min, steady-state rate
 *     is ~16 calls/hour — well within limits even with page refreshes.
 *   - The bot's trading scan (weatherBot.ts) and the frontend router
 *     (getEnsembleForecasts) share this same queue and cache, so they don't
 *     double-spend the hourly budget.
 */

import axios from "axios";

const TOMORROW_BASE = "https://api.tomorrow.io/v4/timelines";
const API_KEY = process.env.TOMORROW_API_KEY ?? "";

export interface TomorrowForecast {
  high: number | null;
  low:  number | null;
  fetchedAt: string;
}

// ── Cache (90 min TTL — reduces repeat calls dramatically) ───────────────────
const cache = new Map<string, { data: TomorrowForecast; expiresAt: number }>();
const CACHE_TTL_MS = 90 * 60 * 1000;

// ── Hourly call tracker ───────────────────────────────────────────────────────
const recentCallTimestamps: number[] = [];
const HOURLY_SOFT_LIMIT = 22;   // refuse new live calls above this; 3-call buffer below 25
const HOUR_MS = 60 * 60 * 1000;

function recordCall() {
  recentCallTimestamps.push(Date.now());
}

function callsInLastHour(): number {
  const cutoff = Date.now() - HOUR_MS;
  // evict old entries
  while (recentCallTimestamps.length && recentCallTimestamps[0] < cutoff) {
    recentCallTimestamps.shift();
  }
  return recentCallTimestamps.length;
}

// ── Serial queue — guarantees at most 1 in-flight HTTP call at a time ────────
// All callers chain onto this promise, so even if 25 cities call simultaneously
// they execute one-by-one, not in a burst.
let callQueue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const queued = callQueue.then(fn);
  // swallow errors on the chain itself so a failure doesn't stall future calls
  callQueue = queued.then(
    () => {},
    () => {}
  );
  return queued;
}

// Min gap between sequential calls: 400ms (well within 3/sec, smooths burst)
let lastCallMs = 0;
async function waitForSlot() {
  const gap = Date.now() - lastCallMs;
  if (gap < 400) await new Promise((r) => setTimeout(r, 400 - gap));
  lastCallMs = Date.now();
}

/**
 * Fetch Tomorrow.io hourly forecast and derive daily high/low for the given date.
 * Returns cached data if still fresh, or null if rate-limited / API error.
 */
export async function getTomorrowForecast(
  lat: number,
  lon: number,
  date: string,
  timezone: string
): Promise<TomorrowForecast | null> {
  if (!API_KEY) return null;

  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${date}`;

  // Always check cache first — even stale cache is returned when rate-limited
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // If hourly budget is exhausted, return stale cache rather than a live call
  if (callsInLastHour() >= HOURLY_SOFT_LIMIT) {
    if (cached) {
      console.warn(`[Tomorrow.io] Hourly limit reached — returning stale cache for ${date}`);
      return cached.data;
    }
    console.warn(`[Tomorrow.io] Hourly limit reached — skipping ${lat.toFixed(2)},${lon.toFixed(2)} ${date}`);
    return null;
  }

  // Enqueue ensures only one HTTP call runs at a time
  return enqueue(async () => {
    // Re-check cache inside queue in case a prior queued call already fetched this key
    const fresh = cache.get(cacheKey);
    if (fresh && fresh.expiresAt > Date.now()) return fresh.data;

    // Re-check rate limit inside queue (another call may have just used the last slot)
    if (callsInLastHour() >= HOURLY_SOFT_LIMIT) {
      console.warn(`[Tomorrow.io] Hourly limit reached inside queue — skipping ${date}`);
      return fresh?.data ?? null;
    }

    await waitForSlot();
    recordCall();

    try {
      const startTime = `${date}T00:00:00Z`;
      const endTime   = `${shiftDate(date, 2)}T23:59:59Z`;

      const res = await axios.get(TOMORROW_BASE, {
        timeout: 10000,
        params: {
          location:  `${lat},${lon}`,
          fields:    "temperature",
          units:     "imperial",
          timestep:  "1h",
          startTime,
          endTime,
          timezone,
          apikey:    API_KEY,
        },
      });

      const intervals: Array<{ startTime: string; values: { temperature: number } }> =
        res.data?.data?.timelines?.[0]?.intervals ?? [];

      if (!intervals.length) return null;

      // Filter to the local calendar date
      let dayTemps = intervals
        .filter((iv) => iv.startTime.startsWith(date))
        .map((iv) => iv.values.temperature)
        .filter((t) => t != null);

      // Fallback: use first 24 hours if timezone prefix matching found nothing
      if (!dayTemps.length) {
        dayTemps = intervals.slice(0, 24).map((iv) => iv.values.temperature);
      }
      if (!dayTemps.length) return null;

      const result: TomorrowForecast = {
        high: Math.round(Math.max(...dayTemps) * 10) / 10,
        low:  Math.round(Math.min(...dayTemps) * 10) / 10,
        fetchedAt: new Date().toISOString(),
      };

      cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      console.log(`[Tomorrow.io] ${date} ${lat.toFixed(2)},${lon.toFixed(2)} → high ${result.high}°F (calls this hour: ${callsInLastHour()})`);
      return result;

    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 429) {
        console.warn(`[Tomorrow.io] 429 received — backing off. Calls this hour: ${callsInLastHour()}`);
        // Mark as if we used the full quota so no more attempts for a while
        for (let i = recentCallTimestamps.length; i < HOURLY_SOFT_LIMIT; i++) {
          recentCallTimestamps.push(Date.now());
        }
      } else if (status === 401) {
        console.error("[Tomorrow.io] 401 — check TOMORROW_API_KEY in .env");
      } else {
        console.warn(`[Tomorrow.io] Error ${status ?? "?"} for ${lat.toFixed(2)},${lon.toFixed(2)}: ${err?.message}`);
      }
      return null;
    }
  });
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function clearTomorrowCache() {
  cache.clear();
}
