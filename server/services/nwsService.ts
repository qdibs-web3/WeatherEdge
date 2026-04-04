import axios from "axios";

const NWS_BASE = "https://api.weather.gov";

export interface CityConfig {
  code: string;
  name: string;
  stationId: string;
  seriesTicker: string;
  lowSeriesTicker?: string; // Kalshi KXLOW series ticker for overnight low markets (populated after discovery)
  sigma: number;        // NWS 1-day forecast error std dev (°F) — calibrated from historical data
  sigmaLow?: number;    // NWS overnight low forecast error (°F); defaults to sigma * 1.15 if not set
  sigmaMkt: number;     // Typical market implied sigma
  shiftFreq: number;    // Fraction of days with ≥2°F shift after NWS update
  lat: number;
  lon: number;
  timezone: string;     // IANA timezone — used for local-date forecast matching (fixes UTC date bug)
  directionBias: number; // °F to add to NWS forecast before probability calc.
                         // Derived from Kalshi 10,556-market historical analysis (greater vs less win rate asymmetry).
                         // Positive = city actual highs tend to EXCEED NWS forecast (runs warm).
                         // Negative = city actual highs tend to FALL SHORT of NWS forecast (runs cold).
  monthlyNormals: number[]; // 30-year NOAA avg daily high by month [Jan..Dec] (°F). Used for temperature regime detection.
}

// ─── City Config ───────────────────────────────────────────────────────────────
// seriesTicker values verified against live Kalshi API (2026-03-08 + 2026-03-29 re-check).
// AUS was KXHIGHAUSTIN (dead, 0 markets) → fixed to KXHIGHAUS
// MSY was KXHIGHMSY (dead) → fixed to KXHIGHTNOLA
// JAX removed: was mapped to KXHIGHMIA (Miami series) — Jacksonville forecast + Miami market = invalid
// SJC removed: was mapped to KXHIGHTSFO (SF series) — different microclimate, misleading
// SAN removed: duplicate of SAT (same coords, same series)
// PHI updated: using KXHIGHPHIL (verified live)
// SAT re-added (2026-03-29): KXHIGHTSATX confirmed live via discoverWeatherSeries (was incorrectly KXHIGHSATX)
// KXLOWT series confirmed live (2026-04-01): NYC, CHI, MIA, LAX, AUS, DEN, PHI only — 7 cities total
// PDX/CLT/TPA/DTW/RDU/BNA: NOT available on Kalshi (confirmed via full series list)
// ─── City Config ───────────────────────────────────────────────────────────────
// directionBias derived from analysis of 10,556 settled Kalshi markets (2026-03-10).
// Method: compare "greater" YES win% vs "less" YES win% per city.
//   greater% >> less% → city runs warm → positive bias (add to NWS forecast)
//   less% >> greater% → city runs cold → negative bias (subtract from NWS forecast)
// Ratios:  PHI 12/3.3=3.6x warm | BOS 9.4/3.1=3x | ATL 9.1/0=∞ warm
//          MSP 6.1/21.2=0.29x cold | DCA 5.9/13.7=0.43x | LAS 0/7.4=0x | AUS 2.2/7.6=0.29x
export const CITIES: Record<string, CityConfig> = {
  NYC: { code: "NYC", name: "New York City",   stationId: "KNYC", seriesTicker: "KXHIGHNY",     lowSeriesTicker: "KXLOWTNYC",  sigma: 3.2, sigmaMkt: 5.5, shiftFreq: 0.42, lat: 40.7789, lon: -73.9692,  timezone: "America/New_York",    directionBias: -0.5, monthlyNormals: [39,42,50,62,72,81,86,84,76,64,53,43] },
  CHI: { code: "CHI", name: "Chicago",         stationId: "KMDW", seriesTicker: "KXHIGHCHI",    lowSeriesTicker: "KXLOWTCHI",  sigma: 3.8, sigmaMkt: 6.2, shiftFreq: 0.48, lat: 41.7868, lon: -87.7522,  timezone: "America/Chicago",     directionBias:  0.0, monthlyNormals: [32,36,47,60,71,81,85,83,76,63,49,36] },
  MIA: { code: "MIA", name: "Miami",           stationId: "KMIA", seriesTicker: "KXHIGHMIA",    lowSeriesTicker: "KXLOWTMIA",  sigma: 2.1, sigmaMkt: 3.8, shiftFreq: 0.28, lat: 25.7959, lon: -80.2870,  timezone: "America/New_York",    directionBias:  0.5, monthlyNormals: [76,77,81,85,88,90,92,92,90,86,82,78] },
  LAX: { code: "LAX", name: "Los Angeles",     stationId: "KLAX", seriesTicker: "KXHIGHLAX",    lowSeriesTicker: "KXLOWTLAX",  sigma: 2.5, sigmaMkt: 4.2, shiftFreq: 0.32, lat: 33.9425, lon: -118.4081, timezone: "America/Los_Angeles",  directionBias:  0.0, monthlyNormals: [68,70,72,75,79,83,88,89,87,82,74,68] },
  AUS: { code: "AUS", name: "Austin",          stationId: "KAUS", seriesTicker: "KXHIGHAUS",    lowSeriesTicker: "KXLOWTAUS",  sigma: 3.5, sigmaMkt: 5.8, shiftFreq: 0.45, lat: 30.1975, lon: -97.6664,  timezone: "America/Chicago",     directionBias: -1.5, monthlyNormals: [61,65,72,80,86,93,97,97,91,81,70,62] },
  HOU: { code: "HOU", name: "Houston",         stationId: "KHOU", seriesTicker: "KXHIGHTHOU",                                 sigma: 3.3, sigmaMkt: 5.5, shiftFreq: 0.44, lat: 29.6454, lon: -95.2789,  timezone: "America/Chicago",     directionBias: -1.5, monthlyNormals: [63,67,74,80,87,93,95,96,91,82,73,65] },
  BOS: { code: "BOS", name: "Boston",          stationId: "KBOS", seriesTicker: "KXHIGHTBOS",                                 sigma: 3.4, sigmaMkt: 5.8, shiftFreq: 0.46, lat: 42.3601, lon: -71.0589,  timezone: "America/New_York",    directionBias:  1.5, monthlyNormals: [37,39,47,58,68,78,83,81,74,62,52,41] },
  SFO: { code: "SFO", name: "San Francisco",   stationId: "KSFO", seriesTicker: "KXHIGHTSFO",                                 sigma: 2.2, sigmaMkt: 3.9, shiftFreq: 0.30, lat: 37.6213, lon: -122.3790, timezone: "America/Los_Angeles",  directionBias:  0.0, monthlyNormals: [57,61,64,67,69,72,72,73,74,71,63,57] },
  SEA: { code: "SEA", name: "Seattle",         stationId: "KSEA", seriesTicker: "KXHIGHTSEA",                                 sigma: 2.8, sigmaMkt: 4.8, shiftFreq: 0.38, lat: 47.4502, lon: -122.3088, timezone: "America/Los_Angeles",  directionBias:  0.0, monthlyNormals: [47,51,56,61,67,72,78,78,72,61,51,45] },
  OKC: { code: "OKC", name: "Oklahoma City",   stationId: "KOKC", seriesTicker: "KXHIGHTOKC",                                 sigma: 4.0, sigmaMkt: 6.5, shiftFreq: 0.50, lat: 35.3931, lon: -97.6007,  timezone: "America/Chicago",     directionBias: -1.0, monthlyNormals: [48,53,61,71,79,88,95,94,85,74,61,51] },
  LAS: { code: "LAS", name: "Las Vegas",       stationId: "KLAS", seriesTicker: "KXHIGHTLV",                                  sigma: 2.6, sigmaMkt: 4.4, shiftFreq: 0.33, lat: 36.0840, lon: -115.1537, timezone: "America/Los_Angeles",  directionBias: -1.5, monthlyNormals: [58,64,71,80,90,101,107,104,96,83,68,57] },
  DCA: { code: "DCA", name: "Washington DC",   stationId: "KDCA", seriesTicker: "KXHIGHTDC",                                  sigma: 3.3, sigmaMkt: 5.6, shiftFreq: 0.43, lat: 38.9072, lon: -77.0369,  timezone: "America/New_York",    directionBias: -1.5, monthlyNormals: [43,47,56,67,77,86,91,89,82,70,58,46] },
  ATL: { code: "ATL", name: "Atlanta",         stationId: "KATL", seriesTicker: "KXHIGHTATL",                                 sigma: 3.0, sigmaMkt: 5.1, shiftFreq: 0.40, lat: 33.7490, lon: -84.3880,  timezone: "America/New_York",    directionBias:  2.0, monthlyNormals: [52,57,65,74,81,88,91,90,84,74,64,54] },
  DAL: { code: "DAL", name: "Dallas",          stationId: "KDAL", seriesTicker: "KXHIGHTDAL",                                 sigma: 3.6, sigmaMkt: 6.0, shiftFreq: 0.46, lat: 32.7767, lon: -96.7970,  timezone: "America/Chicago",     directionBias:  0.0, monthlyNormals: [57,62,71,79,87,95,99,99,92,81,68,59] },
  PHX: { code: "PHX", name: "Phoenix",         stationId: "KPHX", seriesTicker: "KXHIGHTPHX",                                 sigma: 2.4, sigmaMkt: 4.0, shiftFreq: 0.31, lat: 33.4484, lon: -112.0740, timezone: "America/Phoenix",      directionBias:  0.0, monthlyNormals: [68,73,79,87,97,106,106,104,100,89,77,68] },
  MSP: { code: "MSP", name: "Minneapolis",     stationId: "KMSP", seriesTicker: "KXHIGHTMIN",                                 sigma: 4.2, sigmaMkt: 6.8, shiftFreq: 0.52, lat: 44.9778, lon: -93.2650,  timezone: "America/Chicago",     directionBias: -2.0, monthlyNormals: [24,29,42,57,70,80,85,82,73,59,42,27] },
  SAT: { code: "SAT", name: "San Antonio",     stationId: "KSAT", seriesTicker: "KXHIGHTSATX",                                sigma: 3.4, sigmaMkt: 5.8, shiftFreq: 0.44, lat: 29.5337, lon: -98.4698,  timezone: "America/Chicago",     directionBias: -1.0, monthlyNormals: [63,67,75,82,88,95,98,98,92,83,74,65] },
  MSY: { code: "MSY", name: "New Orleans",     stationId: "KMSY", seriesTicker: "KXHIGHTNOLA",                                sigma: 2.9, sigmaMkt: 4.9, shiftFreq: 0.38, lat: 29.9511, lon: -90.0715,  timezone: "America/Chicago",     directionBias: -0.5, monthlyNormals: [62,65,72,79,86,91,92,92,88,80,71,64] },
  DEN: { code: "DEN", name: "Denver",          stationId: "KDEN", seriesTicker: "KXHIGHDEN",    lowSeriesTicker: "KXLOWTDEN",  sigma: 3.9, sigmaLow: 6.5, sigmaMkt: 6.4, shiftFreq: 0.49, lat: 39.7392, lon: -104.9903, timezone: "America/Denver",       directionBias:  0.0, monthlyNormals: [46,50,58,67,76,87,93,90,81,69,55,46] },
  PHI: { code: "PHI", name: "Philadelphia",    stationId: "KPHL", seriesTicker: "KXHIGHPHIL",   lowSeriesTicker: "KXLOWTPHIL", sigma: 3.3, sigmaMkt: 5.6, shiftFreq: 0.43, lat: 39.9526, lon: -75.1652,  timezone: "America/New_York",    directionBias:  2.0, monthlyNormals: [39,43,52,64,74,83,88,86,79,67,55,43] },
  // ── New cities: PENDING ticker verification ───────────────────────────────────────────────────
  // Run discoverWeatherSeries from the bot router to get confirmed Kalshi series tickers,
  // then uncomment each city with its verified seriesTicker.
  //
  // PDX: { code: "PDX", name: "Portland",   stationId: "KPDX", seriesTicker: "???", sigma: 3.2, sigmaMkt: 5.5, shiftFreq: 0.42, lat: 45.5898, lon: -122.5951, timezone: "America/Los_Angeles", directionBias: 0.0, monthlyNormals: [47,52,58,63,70,77,82,81,74,63,52,45] },
  // CLT: { code: "CLT", name: "Charlotte",  stationId: "KCLT", seriesTicker: "???", sigma: 3.1, sigmaMkt: 5.3, shiftFreq: 0.40, lat: 35.2140, lon: -80.9431,  timezone: "America/New_York",    directionBias: 0.0, monthlyNormals: [52,56,64,73,81,88,91,90,83,73,64,55] },
  // TPA: { code: "TPA", name: "Tampa",      stationId: "KTPA", seriesTicker: "???", sigma: 2.3, sigmaMkt: 3.9, shiftFreq: 0.30, lat: 27.9755, lon: -82.5332,  timezone: "America/New_York",    directionBias: 0.0, monthlyNormals: [71,73,78,83,88,91,91,91,89,84,78,73] },
  // DTW: { code: "DTW", name: "Detroit",    stationId: "KDTW", seriesTicker: "???", sigma: 3.7, sigmaMkt: 6.2, shiftFreq: 0.46, lat: 42.2124, lon: -83.3534,  timezone: "America/Detroit",     directionBias: 0.0, monthlyNormals: [31,34,44,57,69,79,83,81,73,61,48,36] },
  // RDU: { code: "RDU", name: "Raleigh",    stationId: "KRDU", seriesTicker: "???", sigma: 3.0, sigmaMkt: 5.1, shiftFreq: 0.40, lat: 35.8801, lon: -78.7880,  timezone: "America/New_York",    directionBias: 0.0, monthlyNormals: [50,54,62,72,79,87,90,88,82,72,62,52] },
  // BNA: { code: "BNA", name: "Nashville",  stationId: "KBNA", seriesTicker: "???", sigma: 3.3, sigmaMkt: 5.6, shiftFreq: 0.43, lat: 36.1245, lon: -86.6782,  timezone: "America/Chicago",     directionBias: 0.0, monthlyNormals: [48,53,62,71,79,87,91,90,83,73,61,51] },
};

export interface NwsForecast {
  cityCode: string;
  cityName: string;
  highTemp: number;
  lowTemp: number;
  shortForecast: string;
  detailedForecast: string;
  windSpeed: string;
  windDirection: string;
  precipChance: number | null;
  forecastDate: string;    // Local date (YYYY-MM-DD) for THIS city's timezone
  fetchedAt: string;
  hourlyHighTemp: number | null;  // High derived from hourly data — more precise than daily period
  forecastAgeMinutes: number;     // How old is the NWS forecast (freshness indicator)
  tomorrowHighTemp: number | null;    // NWS forecast high for next calendar day (city local time)
  tomorrowForecastDate: string;       // Tomorrow's date YYYY-MM-DD in city timezone
  tomorrowLowTemp: number | null;     // NWS overnight low for tomorrow night (for KXLOW markets)
  dayPlusTwoHighTemp: number | null;  // NWS high for day+2 (2 days from today)
  dayPlusTwoDate: string;             // Day+2 date YYYY-MM-DD in city timezone
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
          { headers: { "User-Agent": this.userAgent }, timeout: 15000 }
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
        axios.get(urls.forecast, { headers: { "User-Agent": this.userAgent }, timeout: 15000 }),
        urls.hourly
          ? axios.get(urls.hourly, { headers: { "User-Agent": this.userAgent }, timeout: 15000 })
          : Promise.reject("no hourly url"),
      ]);

      if (forecastRes.status !== "fulfilled") return null;

      const periods = forecastRes.value.data?.properties?.periods ?? [];

      // ── FIX: use local date for THIS city's timezone, not UTC ──
      const todayStr = this.getCityLocalDate(cityCode);
      // Add 24/48 hours then format in city timezone — avoids server-TZ-dependent toISOString() bug
      const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toLocaleDateString("en-CA", { timeZone: city.timezone });
      const dayPlusTwoStr = new Date(Date.now() + 48 * 60 * 60 * 1000)
        .toLocaleDateString("en-CA", { timeZone: city.timezone });

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

      // Period-based low — used as fallback only. hourlyOvernightLow (computed below from
      // hourly data) is preferred for low-market accuracy; see hourly section comment.
      const lowTempPeriodFallback = nightPeriod
        ? nightPeriod.temperatureUnit === "F"
          ? nightPeriod.temperature
          : Math.round(nightPeriod.temperature * 9 / 5 + 32)
        : highTemp - 15;
      // lowTemp is resolved after hourly section runs; declared here for scope, assigned below.
      let lowTemp: number = lowTempPeriodFallback;

      // ── Step 3: Extract hourly highs AND overnight lows from hourly data ──
      //
      // WHY hourly for lows: NWS daily period labels ("Tonight", "Overnight") are
      // ambiguous. At 4 AM, "Tonight" refers to the UPCOMING evening (warm), not
      // the CURRENT overnight trough (cold). Using `!isDaytime && date === todayStr`
      // matches "Tonight" (future, ~60°F) rather than "This Overnight" (current, ~38°F).
      // This caused a 20°F error on Chicago LOW markets and two straight losses.
      //
      // Fix: derive overnight lows from hourly data using a fixed time window:
      //   - Today's overnight low  = min hourly temp in [yesterday 9 PM → today 11 AM]
      //   - Tomorrow's overnight low = min hourly temp in [today 9 PM → tomorrow 11 AM]
      // This captures the full trough regardless of when the scan runs.
      let hourlyHighTemp: number | null = null;
      let tomorrowHourlyHighTemp: number | null = null;
      let dayPlusTwoHourlyHighTemp: number | null = null;
      let hourlyOvernightLow: number | null = null;      // Today's overnight min (derived from hourly)
      let tomorrowHourlyOvernightLow: number | null = null; // Tomorrow's overnight min
      if (hourlyRes.status === "fulfilled") {
        const hourlyPeriods: any[] = hourlyRes.value.data?.properties?.periods ?? [];
        const toF = (p: any) => p.temperatureUnit === "F" ? p.temperature : Math.round(p.temperature * 9 / 5 + 32);

        // Daytime high: all hours on each calendar date
        const todayHourly = hourlyPeriods.filter((p: any) => p.startTime.split("T")[0] === todayStr).map(toF);
        if (todayHourly.length > 0) hourlyHighTemp = Math.max(...todayHourly);

        const tomorrowHourly = hourlyPeriods.filter((p: any) => p.startTime.split("T")[0] === tomorrowStr).map(toF);
        if (tomorrowHourly.length > 0) tomorrowHourlyHighTemp = Math.max(...tomorrowHourly);

        const dayPlusTwoHourly = hourlyPeriods.filter((p: any) => p.startTime.split("T")[0] === dayPlusTwoStr).map(toF);
        if (dayPlusTwoHourly.length > 0) dayPlusTwoHourlyHighTemp = Math.max(...dayPlusTwoHourly);

        // Overnight low: hours between 9 PM the prior evening and 11 AM the measured day.
        // This window reliably captures the temperature trough regardless of scan time.
        const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000)
          .toLocaleDateString("en-CA", { timeZone: city.timezone });

        const todayOvernightHours = hourlyPeriods.filter((p: any) => {
          const pDate = p.startTime.split("T")[0];
          const pHour = parseInt(p.startTime.split("T")[1]?.slice(0, 2) ?? "0", 10);
          // Yesterday 9 PM (21:00) through today 11 AM (10:59)
          return (pDate === yesterdayStr && pHour >= 21) ||
                 (pDate === todayStr    && pHour <= 10);
        }).map(toF);
        if (todayOvernightHours.length > 0) hourlyOvernightLow = Math.min(...todayOvernightHours);

        const tomorrowOvernightHours = hourlyPeriods.filter((p: any) => {
          const pDate = p.startTime.split("T")[0];
          const pHour = parseInt(p.startTime.split("T")[1]?.slice(0, 2) ?? "0", 10);
          // Today 9 PM (21:00) through tomorrow 11 AM (10:59)
          return (pDate === todayStr     && pHour >= 21) ||
                 (pDate === tomorrowStr  && pHour <= 10);
        }).map(toF);
        if (tomorrowOvernightHours.length > 0) tomorrowHourlyOvernightLow = Math.min(...tomorrowOvernightHours);
      }

      // Tomorrow's daily period high (fallback when hourly not yet available for tomorrow)
      const tomorrowDayPeriod = periods.find(
        (p: any) => p.isDaytime && p.startTime.split("T")[0] === tomorrowStr
      );
      const tomorrowDailyHigh = tomorrowDayPeriod
        ? (tomorrowDayPeriod.temperatureUnit === "F"
            ? tomorrowDayPeriod.temperature
            : Math.round(tomorrowDayPeriod.temperature * 9 / 5 + 32))
        : null;

      // Day+2 daily period high (fallback)
      const dayPlusTwoDayPeriod = periods.find(
        (p: any) => p.isDaytime && p.startTime.split("T")[0] === dayPlusTwoStr
      );
      const dayPlusTwoDailyHigh = dayPlusTwoDayPeriod
        ? (dayPlusTwoDayPeriod.temperatureUnit === "F"
            ? dayPlusTwoDayPeriod.temperature
            : Math.round(dayPlusTwoDayPeriod.temperature * 9 / 5 + 32))
        : null;

      // Tonight/tomorrow night low (for KXLOW markets) — prefer hourly-derived overnight min.
      // Period-based lookup is kept as a fallback only since it can return the wrong night
      // (see hourly derivation comment above for full explanation).
      const tomorrowNightPeriod = periods.find(
        (p: any) => !p.isDaytime && p.startTime.split("T")[0] === tomorrowStr
      );
      const tomorrowLowPeriodFallback: number | null = tomorrowNightPeriod
        ? (tomorrowNightPeriod.temperatureUnit === "F"
            ? tomorrowNightPeriod.temperature
            : Math.round(tomorrowNightPeriod.temperature * 9 / 5 + 32))
        : null;
      const tomorrowLowTemp: number | null = tomorrowHourlyOvernightLow ?? tomorrowLowPeriodFallback;

      // Resolve final lowTemp — prefer hourly overnight min over period label
      lowTemp = hourlyOvernightLow ?? lowTempPeriodFallback;

      // ── Extract precip chance from day period ──
      const precipChance: number | null = dayPeriod.probabilityOfPrecipitation?.value ?? null;

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
        windSpeed: dayPeriod.windSpeed ?? "",
        windDirection: dayPeriod.windDirection ?? "",
        precipChance,
        forecastDate: todayStr,
        fetchedAt: new Date().toISOString(),
        hourlyHighTemp,
        forecastAgeMinutes,
        tomorrowHighTemp: tomorrowHourlyHighTemp ?? tomorrowDailyHigh,
        tomorrowForecastDate: tomorrowStr,
        tomorrowLowTemp,
        dayPlusTwoHighTemp: dayPlusTwoHourlyHighTemp ?? dayPlusTwoDailyHigh,
        dayPlusTwoDate: dayPlusTwoStr,
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
