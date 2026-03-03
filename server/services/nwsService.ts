import axios from "axios";

const NWS_BASE = "https://api.weather.gov";

export interface CityConfig {
  code: string;
  name: string;
  stationId: string;
  seriesTicker: string;
  sigma: number;       // NWS 1-day forecast error std dev (°F)
  sigmaMkt: number;    // Typical market stale sigma
  shiftFreq: number;   // Fraction of days with ≥2°F shift
  lat: number;
  lon: number;
}

export const CITIES: Record<string, CityConfig> = {
  NYC: { code: "NYC", name: "New York City",   stationId: "KNYC", seriesTicker: "KXHIGHNY",   sigma: 3.2, sigmaMkt: 5.5, shiftFreq: 0.42, lat: 40.7789, lon: -73.9692 },
  CHI: { code: "CHI", name: "Chicago",         stationId: "KMDW", seriesTicker: "KXHIGHCHI", sigma: 3.8, sigmaMkt: 6.2, shiftFreq: 0.48, lat: 41.7868, lon: -87.7522 },
  MIA: { code: "MIA", name: "Miami",           stationId: "KMIA", seriesTicker: "KXHIGHMIA", sigma: 2.1, sigmaMkt: 3.8, shiftFreq: 0.28, lat: 25.7959, lon: -80.2870 },
  LAX: { code: "LAX", name: "Los Angeles",     stationId: "KLAX", seriesTicker: "KXHIGHLAX", sigma: 2.5, sigmaMkt: 4.2, shiftFreq: 0.32, lat: 33.9425, lon: -118.4081 },
  AUS: { code: "AUS", name: "Austin",          stationId: "KAUS", seriesTicker: "KXHIGHAUSTIN", sigma: 3.5, sigmaMkt: 5.8, shiftFreq: 0.45, lat: 30.1975, lon: -97.6664 },
  HOU: { code: "HOU", name: "Houston",         stationId: "KHOU", seriesTicker: "KXHIGHTHOU",  sigma: 3.3, sigmaMkt: 5.5, shiftFreq: 0.44, lat: 29.6454, lon: -95.2789 },
  BOS: { code: "BOS", name: "Boston",          stationId: "KBOS", seriesTicker: "KXHIGHTBOS",  sigma: 3.4, sigmaMkt: 5.8, shiftFreq: 0.46, lat: 42.3601, lon: -71.0589 },
  SFO: { code: "SFO", name: "San Francisco",   stationId: "KSFO", seriesTicker: "KXHIGHTSFO",  sigma: 2.2, sigmaMkt: 3.9, shiftFreq: 0.30, lat: 37.6213, lon: -122.3790 },
  SEA: { code: "SEA", name: "Seattle",         stationId: "KSEA", seriesTicker: "KXHIGHTSEA",  sigma: 2.8, sigmaMkt: 4.8, shiftFreq: 0.38, lat: 47.4502, lon: -122.3088 },
  OKC: { code: "OKC", name: "Oklahoma City",   stationId: "KOKC", seriesTicker: "KXHIGHTOKC",  sigma: 4.0, sigmaMkt: 6.5, shiftFreq: 0.50, lat: 35.3931, lon: -97.6007 },
  LAS: { code: "LAS", name: "Las Vegas",       stationId: "KLAS", seriesTicker: "KXHIGHTLV",   sigma: 2.6, sigmaMkt: 4.4, shiftFreq: 0.33, lat: 36.0840, lon: -115.1537 },
  DCA: { code: "DCA", name: "Washington DC",   stationId: "KDCA", seriesTicker: "KXHIGHTDC",   sigma: 3.3, sigmaMkt: 5.6, shiftFreq: 0.43, lat: 38.9072, lon: -77.0369 },
  ATL: { code: "ATL", name: "Atlanta",         stationId: "KATL", seriesTicker: "KXHIGHTATL",  sigma: 3.0, sigmaMkt: 5.1, shiftFreq: 0.40, lat: 33.7490, lon: -84.3880 },
  DAL: { code: "DAL", name: "Dallas",          stationId: "KDAL", seriesTicker: "KXHIGHTDAL",  sigma: 3.6, sigmaMkt: 6.0, shiftFreq: 0.46, lat: 32.7767, lon: -96.7970 },
  PHX: { code: "PHX", name: "Phoenix",         stationId: "KPHX", seriesTicker: "KXHIGHTPHX",  sigma: 2.4, sigmaMkt: 4.0, shiftFreq: 0.31, lat: 33.4484, lon: -112.0740 },
  MSP: { code: "MSP", name: "Minneapolis",     stationId: "KMSP", seriesTicker: "KXHIGHTMIN",  sigma: 4.2, sigmaMkt: 6.8, shiftFreq: 0.52, lat: 44.9778, lon: -93.2650 },
  SAT: { code: "SAT", name: "San Antonio",     stationId: "KSAT", seriesTicker: "KXHIGHTSATX", sigma: 3.4, sigmaMkt: 5.7, shiftFreq: 0.44, lat: 29.4241, lon: -98.4936 },
  SAN: { code: "SAN", name: "San Antonio",     stationId: "KSAT", seriesTicker: "KXHIGHTSATX", sigma: 3.4, sigmaMkt: 5.7, shiftFreq: 0.44, lat: 29.4241, lon: -98.4936 },
  PHI: { code: "PHI", name: "Philadelphia",    stationId: "KPHL", seriesTicker: "KXHIGHPHIL",  sigma: 3.3, sigmaMkt: 5.6, shiftFreq: 0.43, lat: 39.9526, lon: -75.1652 },
  SJC: { code: "SJC", name: "San Jose",        stationId: "KSJC", seriesTicker: "KXHIGHTSFO",  sigma: 2.2, sigmaMkt: 3.9, shiftFreq: 0.30, lat: 37.3382, lon: -121.8863 },
  JAX: { code: "JAX", name: "Jacksonville",    stationId: "KJAX", seriesTicker: "KXHIGHMIA",   sigma: 2.8, sigmaMkt: 4.9, shiftFreq: 0.35, lat: 30.3322, lon: -81.6557 },
  MSY: { code: "MSY", name: "New Orleans",     stationId: "KMSY", seriesTicker: "KXHIGHMSY", sigma: 2.9, sigmaMkt: 4.9, shiftFreq: 0.38, lat: 29.9511, lon: -90.0715 },
  DEN: { code: "DEN", name: "Denver",          stationId: "KDEN", seriesTicker: "KXHIGHDEN", sigma: 3.9, sigmaMkt: 6.4, shiftFreq: 0.49, lat: 39.7392, lon: -104.9903 },
};

export interface NwsForecast {
  cityCode: string;
  cityName: string;
  highTemp: number;
  lowTemp: number;
  shortForecast: string;
  detailedForecast: string;
  forecastDate: string;
  fetchedAt: string;
}

// Cache to avoid hammering NWS
const cache: Map<string, { data: NwsForecast; expiresAt: number }> = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class NwsService {
  private userAgent: string;
  // Cache gridpoint URLs per station to avoid repeated lookups
  private gridpointCache: Map<string, string> = new Map();

  constructor(userAgent: string) {
    this.userAgent = userAgent || "(KalshiWeatherBot, admin@example.com)";
  }

  async getForecast(cityCode: string): Promise<NwsForecast | null> {
    const cached = cache.get(cityCode);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const city = CITIES[cityCode];
    if (!city) return null;

    try {
      // Step 1: Get forecast URL from gridpoint (cached)
      let forecastUrl = this.gridpointCache.get(cityCode);
      if (!forecastUrl) {
        const pointRes = await axios.get(
          `${NWS_BASE}/points/${city.lat},${city.lon}`,
          { headers: { "User-Agent": this.userAgent }, timeout: 8000 }
        );
        forecastUrl = pointRes.data?.properties?.forecast;
        if (!forecastUrl) return null;
        this.gridpointCache.set(cityCode, forecastUrl);
      }

      // Step 2: Get forecast
      const forecastRes = await axios.get(forecastUrl, {
        headers: { "User-Agent": this.userAgent },
        timeout: 8000,
      });
      const periods = forecastRes.data?.properties?.periods ?? [];

      // Find today's daytime period
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];

      let dayPeriod = periods.find(
        (p: any) => p.isDaytime && p.startTime.startsWith(todayStr)
      );
      // Fallback: first daytime period
      if (!dayPeriod) dayPeriod = periods.find((p: any) => p.isDaytime);
      if (!dayPeriod) return null;

      let nightPeriod = periods.find(
        (p: any) => !p.isDaytime && p.startTime.startsWith(todayStr)
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

      const forecast: NwsForecast = {
        cityCode,
        cityName: city.name,
        highTemp,
        lowTemp,
        shortForecast: dayPeriod.shortForecast,
        detailedForecast: dayPeriod.detailedForecast,
        forecastDate: todayStr,
        fetchedAt: new Date().toISOString(),
      };

      cache.set(cityCode, { data: forecast, expiresAt: Date.now() + CACHE_TTL_MS });
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
    cache.clear();
    this.gridpointCache.clear();
  }
}