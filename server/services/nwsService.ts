import axios from "axios";

const NWS_BASE = "https://api.weather.gov";

export interface CityConfig {
  code: string;
  name: string;
  stationId: string;
  seriesTicker: string;
  sigma: number;       // NWS 1-day forecast error std dev (°F) — calibrated from historical data
  sigmaMkt: number;    // Typical market implied sigma
  shiftFreq: number;   // Fraction of days with ≥2°F shift after NWS update
  lat: number;
  lon: number;
  timezone: string;    // IANA timezone — used for local-date forecast matching (fixes UTC date bug)
}

// ─── City Config ───────────────────────────────────────────────────────────────
// seriesTicker values verified against live Kalshi API (2026-03-08).
// AUS was KXHIGHAUSTIN (dead, 0 markets) → fixed to KXHIGHAUS
// MSY was KXHIGHMSY (dead) → fixed to KXHIGHTNOLA
// JAX removed: was mapped to KXHIGHMIA (Miami series) — Jacksonville forecast + Miami market = invalid
// SJC removed: was mapped to KXHIGHTSFO (SF series) — different microclimate, misleading
// SAN removed: duplicate of SAT (same coords, same series)
// PHI updated: using KXHIGHPHIL (verified live)
export const CITIES: Record<string, CityConfig> = {
  NYC: { code: "NYC", name: "New York City",   stationId: "KNYC", seriesTicker: "KXHIGHNY",     sigma: 3.2, sigmaMkt: 5.5, shiftFreq: 0.42, lat: 40.7789, lon: -73.9692,  timezone: "America/New_York"    },
  CHI: { code: "CHI", name: "Chicago",         stationId: "KMDW", seriesTicker: "KXHIGHCHI",    sigma: 3.8, sigmaMkt: 6.2, shiftFreq: 0.48, lat: 41.7868, lon: -87.7522,  timezone: "America/Chicago"     },
  MIA: { code: "MIA", name: "Miami",           stationId: "KMIA", seriesTicker: "KXHIGHMIA",    sigma: 2.1, sigmaMkt: 3.8, shiftFreq: 0.28, lat: 25.7959, lon: -80.2870,  timezone: "America/New_York"    },
  LAX: { code: "LAX", name: "Los Angeles",     stationId: "KLAX", seriesTicker: "KXHIGHLAX",    sigma: 2.5, sigmaMkt: 4.2, shiftFreq: 0.32, lat: 33.9425, lon: -118.4081, timezone: "America/Los_Angeles" },
  AUS: { code: "AUS", name: "Austin",          stationId: "KAUS", seriesTicker: "KXHIGHAUS",    sigma: 3.5, sigmaMkt: 5.8, shiftFreq: 0.45, lat: 30.1975, lon: -97.6664,  timezone: "America/Chicago"     },
  HOU: { code: "HOU", name: "Houston",         stationId: "KHOU", seriesTicker: "KXHIGHTHOU",   sigma: 3.3, sigmaMkt: 5.5, shiftFreq: 0.44, lat: 29.6454, lon: -95.2789,  timezone: "America/Chicago"     },
  BOS: { code: "BOS", name: "Boston",          stationId: "KBOS", seriesTicker: "KXHIGHTBOS",   sigma: 3.4, sigmaMkt: 5.8, shiftFreq: 0.46, lat: 42.3601, lon: -71.0589,  timezone: "America/New_York"    },
  SFO: { code: "SFO", name: "San Francisco",   stationId: "KSFO", seriesTicker: "KXHIGHTSFO",   sigma: 2.2, sigmaMkt: 3.9, shiftFreq: 0.30, lat: 37.6213, lon: -122.3790, timezone: "America/Los_Angeles" },
  SEA: { code: "SEA", name: "Seattle",         stationId: "KSEA", seriesTicker: "KXHIGHTSEA",   sigma: 2.8, sigmaMkt: 4.8, shiftFreq: 0.38, lat: 47.4502, lon: -122.3088, timezone: "America/Los_Angeles" },
  OKC: { code: "OKC", name: "Oklahoma City",   stationId: "KOKC", seriesTicker: "KXHIGHTOKC",   sigma: 4.0, sigmaMkt: 6.5, shiftFreq: 0.50, lat: 35.3931, lon: -97.6007,  timezone: "America/Chicago"     },
  LAS: { code: "LAS", name: "Las Vegas",       stationId: "KLAS", seriesTicker: "KXHIGHTLV",    sigma: 2.6, sigmaMkt: 4.4, shiftFreq: 0.33, lat: 36.0840, lon: -115.1537, timezone: "America/Los_Angeles" },
  DCA: { code: "DCA", name: "Washington DC",   stationId: "KDCA", seriesTicker: "KXHIGHTDC",    sigma: 3.3, sigmaMkt: 5.6, shiftFreq: 0.43, lat: 38.9072, lon: -77.0369,  timezone: "America/New_York"    },
  ATL: { code: "ATL", name: "Atlanta",         stationId: "KATL", seriesTicker: "KXHIGHTATL",   sigma: 3.0, sigmaMkt: 5.1, shiftFreq: 0.40, lat: 33.7490, lon: -84.3880,  timezone: "America/New_York"    },
  DAL: { code: "DAL", name: "Dallas",          stationId: "KDAL", seriesTicker: "KXHIGHTDAL",   sigma: 3.6, sigmaMkt: 6.0, shiftFreq: 0.46, lat: 32.7767, lon: -96.7970,  timezone: "America/Chicago"     },
  PHX: { code: "PHX", name: "Phoenix",         stationId: "KPHX", seriesTicker: "KXHIGHTPHX",   sigma: 2.4, sigmaMkt: 4.0, shiftFreq: 0.31, lat: 33.4484, lon: -112.0740, timezone: "America/Phoenix"     },
  MSP: { code: "MSP", name: "Minneapolis",     stationId: "KMSP", seriesTicker: "KXHIGHTMIN",   sigma: 4.2, sigmaMkt: 6.8, shiftFreq: 0.52, lat: 44.9778, lon: -93.2650,  timezone: "America/Chicago"     },
  SAT: { code: "SAT", name: "San Antonio",     stationId: "KSAT", seriesTicker: "KXHIGHTSATX",  sigma: 3.4, sigmaMkt: 5.7, shiftFreq: 0.44, lat: 29.4241, lon: -98.4936,  timezone: "America/Chicago"     },
  MSY: { code: "MSY", name: "New Orleans",     stationId: "KMSY", seriesTicker: "KXHIGHTNOLA",  sigma: 2.9, sigmaMkt: 4.9, shiftFreq: 0.38, lat: 29.9511, lon: -90.0715,  timezone: "America/Chicago"     },
  DEN: { code: "DEN", name: "Denver",          stationId: "KDEN", seriesTicker: "KXHIGHDEN",    sigma: 3.9, sigmaMkt: 6.4, shiftFreq: 0.49, lat: 39.7392, lon: -104.9903, timezone: "America/Denver"      },
  PHI: { code: "PHI", name: "Philadelphia",    stationId: "KPHL", seriesTicker: "KXHIGHPHIL",   sigma: 3.3, sigmaMkt: 5.6, shiftFreq: 0.43, lat: 39.9526, lon: -75.1652,  timezone: "America/New_York"    },
};

export interface NwsForecast {
  cityCode: string;
  cityName: string;
  highTemp: number;
  lowTemp: number;
  shortForecast: string;
  detailedForecast: string;
  forecastDate: string;    // Local date (YYYY-MM-DD) for THIS city's timezone
  fetchedAt: string;
  hourlyHighTemp: number | null;  // High derived from hourly data — more precise than daily period
  forecastAgeMinutes: number;     // How old is the NWS forecast (freshness indicator)
}

// ─── In-memory cache ────────────────────────────────────────────────────────────
const forecastCache: Map<string, { data: NwsForecast; expiresAt: number }> = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — refresh well within NWS 6h update cycle

export class NwsService {
  private userAgent: string;
  // Cache gridpoint/hourly URLs per station to avoid repeated lookups
  private gridpointCache: Map<string, { forecast: string; hourly: string }> = new Map();

  constructor(userAgent: string) {
    this.userAgent = userAgent || "(WeatherEdgeBot, admin@example.com)";
  }

  /**
   * Get the local date string (YYYY-MM-DD) for a city in its own timezone.
   *
   * BUG FIX: Previously used `new Date().toISOString().split("T")[0]` which returns
   * the UTC date. After 7 PM Eastern (midnight UTC), this returns *tomorrow's* date,
   * causing the bot to use tomorrow's NWS forecast for today's Kalshi market.
   *
   * Fix: use `toLocaleDateString("en-CA", { timeZone })` which returns YYYY-MM-DD
   * in the city's local timezone.
   */
  private getCityLocalDate(cityCode: string): string {
    const city = CITIES[cityCode];
    const tz = city?.timezone ?? "America/New_York";
    return new Date().toLocaleDateString("en-CA", { timeZone: tz });
  }

  async getForecast(cityCode: string): Promise<NwsForecast | null> {
    const cached = forecastCache.get(cityCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const city = CITIES[cityCode];
    if (!city) return null;

    try {
      // Step 1: Get forecast + hourly URLs from /points (cached per station)
      let urls = this.gridpointCache.get(cityCode);
      if (!urls) {
        const pointRes = await axios.get(
          `${NWS_BASE}/points/${city.lat},${city.lon}`,
          { headers: { "User-Agent": this.userAgent }, timeout: 8000 }
        );
        const props = pointRes.data?.properties;
        const forecastUrl = props?.forecast;
        const hourlyUrl = props?.forecastHourly;
        if (!forecastUrl) return null;
        urls = { forecast: forecastUrl, hourly: hourlyUrl ?? "" };
        this.gridpointCache.set(cityCode, urls);
      }

      // Step 2: Fetch daily forecast
      const [forecastRes, hourlyRes] = await Promise.allSettled([
        axios.get(urls.forecast, { headers: { "User-Agent": this.userAgent }, timeout: 8000 }),
        urls.hourly
          ? axios.get(urls.hourly, { headers: { "User-Agent": this.userAgent }, timeout: 8000 })
          : Promise.reject("no hourly url"),
      ]);

      if (forecastRes.status !== "fulfilled") return null;

      const periods = forecastRes.value.data?.properties?.periods ?? [];

      // ── FIX: use local date for THIS city's timezone, not UTC ──
      const todayStr = this.getCityLocalDate(cityCode);
      const tomorrowDate = new Date(new Date().toLocaleDateString("en-CA", { timeZone: city.timezone }) + "T12:00:00");
      tomorrowDate.setDate(tomorrowDate.getDate() + 1);
      const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

      // Find today's daytime period using LOCAL date comparison
      let dayPeriod = periods.find(
        (p: any) => p.isDaytime && p.startTime.split("T")[0] === todayStr
      );
      // Fallback: first daytime period (catches late-night runs)
      if (!dayPeriod) dayPeriod = periods.find((p: any) => p.isDaytime);
      if (!dayPeriod) return null;

      let nightPeriod = periods.find(
        (p: any) => !p.isDaytime && p.startTime.split("T")[0] === todayStr
      );
      if (!nightPeriod) nightPeriod = periods.find((p: any) => !p.isDaytime);

      const highTemp =
        dayPeriod.temperatureUnit === "F"
          ? dayPeriod.temperature
          : Math.round(dayPeriod.temperature * 9 / 5 + 32);

      const lowTemp = nightPeriod
        ? nightPeriod.temperatureUnit === "F"
          ? nightPeriod.temperature
          : Math.round(nightPeriod.temperature * 9 / 5 + 32)
        : highTemp - 15;

      // ── Step 3: Extract hourly high for today (more precise) ──
      let hourlyHighTemp: number | null = null;
      if (hourlyRes.status === "fulfilled") {
        const hourlyPeriods: any[] = hourlyRes.value.data?.properties?.periods ?? [];
        // Get all hourly temps for today in local time
        const todayHourlyTemps = hourlyPeriods
          .filter((p: any) => p.startTime.split("T")[0] === todayStr)
          .map((p: any) =>
            p.temperatureUnit === "F"
              ? p.temperature
              : Math.round(p.temperature * 9 / 5 + 32)
          );
        if (todayHourlyTemps.length > 0) {
          hourlyHighTemp = Math.max(...todayHourlyTemps);
        }
      }

      // ── Step 4: Estimate forecast age (how long ago was this NWS run issued?) ──
      // NWS forecast periods include a generatedAt/updateTime in the response
      const generatedAt = forecastRes.value.data?.properties?.generatedAt;
      const forecastAgeMinutes = generatedAt
        ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000)
        : -1;

      const forecast: NwsForecast = {
        cityCode,
        cityName: city.name,
        highTemp: hourlyHighTemp ?? highTemp, // prefer hourly-derived high
        lowTemp,
        shortForecast: dayPeriod.shortForecast,
        detailedForecast: dayPeriod.detailedForecast,
        forecastDate: todayStr,
        fetchedAt: new Date().toISOString(),
        hourlyHighTemp,
        forecastAgeMinutes,
      };

      forecastCache.set(cityCode, { data: forecast, expiresAt: Date.now() + CACHE_TTL_MS });
      return forecast;
    } catch (err: any) {
      console.error(`[NWS] Failed to fetch forecast for ${cityCode}:`, err.message);
      return null;
    }
  }

  async getAllForecasts(): Promise<NwsForecast[]> {
    const results = await Promise.allSettled(
      Object.keys(CITIES).map((code) => this.getForecast(code))
    );
    return results
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => (r as PromiseFulfilledResult<NwsForecast>).value);
  }

  clearCache() {
    forecastCache.clear();
    this.gridpointCache.clear();
  }
}
