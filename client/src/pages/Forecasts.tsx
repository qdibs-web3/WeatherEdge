import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CloudSun, RefreshCw, Thermometer, TrendingUp, AlertCircle,
  CheckCircle2, Wind, Droplets, ArrowDown, Activity
} from "lucide-react";
import { toast } from "sonner";

export default function Forecasts() {
  const { data: forecasts, isLoading, refetch, isFetching } = trpc.bot.getForecasts.useQuery(
    undefined,
    { refetchInterval: 300_000 }
  );
  const { data: ensembleData } = trpc.bot.getEnsembleForecasts.useQuery(
    undefined,
    { refetchInterval: 300_000 }
  );
  const { data: botStatus } = trpc.bot.getStatus.useQuery(undefined, { refetchInterval: 30_000 });
  const { data: botConfig } = trpc.config.getBotConfig.useQuery();

  // Build a map of cityCode → full ensemble entry for quick lookup
  const ensembleMap = new Map<string, any>(
    (ensembleData ?? []).map((e: any) => [e.cityCode, e])
  );

  const flatBet = (botConfig as any)?.flatBetDollars ?? 20;
  const KALSHI_FEE_RATE = 0.07;

  // Use live in-memory signals from bot status (has ev, contracts, ourProb)
  const lastSignals: any[] = (botStatus as any)?.lastSignals ?? [];
  const signalMap = new Map(lastSignals.map((s: any) => [s.cityCode, s]));

  // Wind direction abbreviation → arrow character
  const windArrow: Record<string, string> = {
    N: "↑", NNE: "↑", NE: "↗", ENE: "↗",
    E: "→", ESE: "↘", SE: "↘", SSE: "↓",
    S: "↓", SSW: "↓", SW: "↙", WSW: "↙",
    W: "←", WNW: "↖", NW: "↖", NNW: "↑",
  };

  return (
    <div className="p-6 space-y-6 max-w-[70%] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Live Forecasts</h1>
          <p className="text-sm text-gray-400">NWS + 3-model ensemble (Best/ICON/GEM) for all cities — updates every 5 minutes</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-[#27272a] text-gray-300 hover:text-white"
          onClick={() => { refetch(); toast.info("Refreshing forecasts..."); }}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Strategy Explanation */}
      <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-300">How the Edge Works</p>
            <p className="text-xs text-gray-400 mt-1">
              The NWS issues forecast updates at 6am, 12pm, 6pm, and midnight local time. Kalshi markets are slow to reprice after each update.
              The bot compares the NWS high-temp probability distribution against Kalshi contract prices and trades when our model shows a{" "}
              <span className="text-blue-300 font-medium">positive expected value edge of 3+ cents</span> per contract.
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-[#18181b] border-[#27272a] animate-pulse">
              <CardContent className="p-4 h-40" />
            </Card>
          ))}
        </div>
      ) : forecasts && forecasts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forecasts.map((f: any) => {
            const signal = signalMap.get(f.cityCode);
            const hasSignal = !!signal;
            const high = f.highTemp != null ? Math.round(Number(f.highTemp) * 10) / 10 : null;
            const low = f.lowTemp != null ? Math.round(Number(f.lowTemp) * 10) / 10 : null;
            const precip = f.precipChance != null ? Number(f.precipChance) : null;
            const sigma = f.sigma != null ? Number(f.sigma).toFixed(1) : null;
            const windDir = f.windDirection ?? "";
            const windArrowChar = windArrow[windDir] ?? "";
            const ensEntry   = ensembleMap.get(f.cityCode);
            const ensemble   = ensEntry?.ensemble ?? null;
            const ensBias    = ensEntry?.directionBias ?? 0;
            const ensDate    = ensEntry?.date ?? null;
            const ensDateLabel = ensDate
              ? new Date(ensDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              : null;
            const spreadOk   = !ensemble || ensemble.spread <= 3;
            const spreadWarn = ensemble && ensemble.spread > 3 && ensemble.spread <= 6;
            const spreadBad  = ensemble && ensemble.spread > 6;
            // Blended forecast the bot uses: NWS×40% + ensemble consensus×60%, then bias applied
            const blendedForecast = high != null && ensemble
              ? Math.round((high * 0.40 + ensemble.consensus * 0.60 + ensBias) * 10) / 10
              : null;
            const nwsVsDelta = high != null && ensemble
              ? Math.round((ensemble.consensus - high) * 10) / 10
              : null;
            const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
            const tomorrowHigh = f.tomorrowHigh != null ? Math.round(Number(f.tomorrowHigh) * 10) / 10 : null;
            const tomorrowLabel = f.tomorrowForecastDate
              ? new Date(f.tomorrowForecastDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              : null;

            return (
              <Card
                key={f.cityCode}
                className={`bg-[#18181b] border-[#27272a] transition-all ${hasSignal ? "border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]" : ""}`}
              >
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold text-white">{f.cityName}</CardTitle>
                      <p className="text-xs text-gray-500 mt-0.5">{f.cityCode}</p>
                    </div>
                    {hasSignal ? (
                      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                        <TrendingUp className="h-3 w-3 mr-1" /> Signal
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-[#3f3f46] text-gray-500 text-xs">No Signal</Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="px-4 pb-4 space-y-3">

                  {/* Temperature row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Thermometer className="h-4 w-4 text-orange-400 shrink-0" />
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-bold text-white">{high != null ? high.toFixed(1) : "—"}°</span>
                          <span className="text-xs text-gray-500">F high</span>
                        </div>
                        {low != null && (
                          <div className="flex items-center gap-1 text-xs text-gray-400">
                            <ArrowDown className="h-3 w-3 text-blue-400" />
                            <span>Low {low != null ? low.toFixed(1) : "—"}°F</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Precip + Wind column */}
                    <div className="text-right space-y-1">
                      {precip != null && (
                        <div className="flex items-center justify-end gap-1 text-xs text-blue-300">
                          <Droplets className="h-3 w-3" />
                          <span>{precip}% precip</span>
                        </div>
                      )}
                      {f.windSpeed && (
                        <div className="flex items-center justify-end gap-1 text-xs text-gray-400">
                          <Wind className="h-3 w-3" />
                          <span>{windArrowChar} {f.windSpeed}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Short forecast description */}
                  {f.shortForecast && (
                    <p className="text-xs text-gray-400 leading-relaxed">{f.shortForecast}</p>
                  )}

                  {/* Date + sigma row */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[#27272a] rounded-md px-2.5 py-1.5">
                      <p className="text-xs text-gray-500">Forecast Date</p>
                      <p className="text-xs font-medium text-gray-300">{todayLabel}</p>
                    </div>
                    <div className="bg-[#27272a] rounded-md px-2.5 py-1.5">
                      <p className="text-xs text-gray-500">Model σ</p>
                      <p className="text-xs font-medium text-gray-300">{sigma ? `±${sigma}°F` : "—"}</p>
                    </div>
                  </div>

                  {/* Tomorrow's NWS forecast */}
                  {tomorrowHigh != null && tomorrowLabel && (
                    <div className="bg-[#27272a] rounded-md px-2.5 py-1.5 flex items-center justify-between">
                      <div>
                        <p className="text-xs text-gray-500">Tomorrow · {tomorrowLabel}</p>
                        <p className="text-xs font-medium text-gray-300">NWS high {tomorrowHigh != null ? tomorrowHigh.toFixed(1) : "—"}°F</p>
                      </div>
                      <span className="text-sm font-bold text-gray-300">{tomorrowHigh != null ? tomorrowHigh.toFixed(1) : "—"}°</span>
                    </div>
                  )}

                  {/* Multi-model ensemble block */}
                  {ensemble ? (
                    <div className={`rounded-md px-2.5 py-2 space-y-1.5 border ${
                      spreadBad  ? "bg-red-500/5 border-red-500/20" :
                      spreadWarn ? "bg-yellow-500/5 border-yellow-500/20" :
                                   "bg-emerald-500/5 border-emerald-500/20"
                    }`}>
                      {/* Header row */}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium text-gray-400">3-Model Ensemble</p>
                          {ensDateLabel && (
                            <p className="text-[10px] text-gray-600 leading-none mt-0.5">{ensDateLabel}</p>
                          )}
                        </div>
                        <span className={`text-xs font-semibold ${
                          spreadBad ? "text-red-400" : spreadWarn ? "text-yellow-400" : "text-emerald-400"
                        }`}>
                          {spreadBad ? "⚠ Disagree" : spreadWarn ? "~ Partial" : "✓ Agree"} ±{ensemble.spread}°F
                        </span>
                      </div>

                      {/* Individual model readings with weights */}
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        <div className="text-center">
                          <p className="text-gray-500">Best<span className="text-gray-600"> 30%</span></p>
                          <p className="text-gray-200 font-medium">{ensemble.bestMatch != null ? `${(Math.round(ensemble.bestMatch * 10) / 10).toFixed(1)}°` : "—"}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-gray-500">ICON<span className="text-gray-600"> 45%</span></p>
                          <p className="text-gray-200 font-medium">{ensemble.icon != null ? `${(Math.round(ensemble.icon * 10) / 10).toFixed(1)}°` : "—"}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-gray-500">GEM<span className="text-gray-600"> 25%</span></p>
                          <p className="text-gray-200 font-medium">{ensemble.gem != null ? `${(Math.round(ensemble.gem * 10) / 10).toFixed(1)}°` : "—"}</p>
                        </div>
                      </div>

                      {/* Consensus + NWS delta */}
                      <div className="flex items-center justify-between pt-0.5 border-t border-white/5">
                        <p className="text-xs text-gray-500">Ensemble consensus</p>
                        <div className="text-right">
                          <p className="text-xs font-semibold text-white">{ensemble.consensus}°F</p>
                          {nwsVsDelta !== null && (
                            <p className={`text-[10px] leading-none ${nwsVsDelta > 0 ? "text-orange-400" : nwsVsDelta < 0 ? "text-blue-400" : "text-gray-500"}`}>
                              {nwsVsDelta > 0 ? "+" : ""}{nwsVsDelta}° vs NWS
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Bot blended forecast + bias */}
                      <div className="flex items-center justify-between pt-0.5 border-t border-white/5">
                        <div>
                          <p className="text-xs text-gray-500">Bot uses (NWS×40% + ens×60%)</p>
                          {ensBias !== 0 && (
                            <p className="text-[10px] text-gray-600 leading-none mt-0.5">
                              bias {ensBias > 0 ? "+" : ""}{ensBias}°F applied
                            </p>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-blue-300">
                          {blendedForecast != null ? `${blendedForecast}°F` : "—"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-[#27272a] rounded-md px-2.5 py-1.5 text-xs text-gray-500">
                      Ensemble loading...
                    </div>
                  )}

                  {/* Active signal box */}
                  {hasSignal && signal && (() => {
                    const ev: number = signal.ev ?? 0;
                    const contracts: number = signal.contracts ?? Math.floor(flatBet / (signal.priceCents / 100));
                    const costBasis = (contracts * signal.priceCents) / 100;
                    // Net profit if we win, net loss if we lose — expected value across all contracts
                    const grossWinPerContract = 100 - signal.priceCents;
                    const netWinPerContract = grossWinPerContract * (1 - KALSHI_FEE_RATE);
                    const totalExpectedProfit = (signal.ourProb * netWinPerContract - (1 - signal.ourProb) * signal.priceCents) * contracts / 100;
                    return (
                      <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <Activity className="h-3 w-3 text-blue-400" />
                          <p className="text-xs font-medium text-blue-300">Active Signal</p>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <span className="text-gray-500">Market</span>
                          <span className="text-gray-300 font-mono truncate text-right">{signal.ticker}</span>
                          <span className="text-gray-500">Side</span>
                          <span className={`text-right font-semibold ${signal.side === "yes" ? "text-green-400" : "text-red-400"}`}>
                            {signal.side?.toUpperCase()}
                          </span>
                          <span className="text-gray-500">Entry</span>
                          <span className="text-gray-300 text-right">{contracts} × {signal.priceCents}¢ = ${costBasis.toFixed(2)}</span>
                          <span className="text-gray-500">EV / contract</span>
                          <span className="text-blue-300 font-semibold text-right">+{ev.toFixed(1)}¢</span>
                          <span className="text-gray-500">Expected Profit</span>
                          <span className={`font-semibold text-right ${totalExpectedProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {totalExpectedProfit >= 0 ? "+" : ""}${totalExpectedProfit.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Updated timestamp */}
                  <div className="flex items-center gap-1.5 text-xs text-gray-600">
                    <CheckCircle2 className="h-3 w-3" />
                    Updated {f.updatedAt ? new Date(f.updatedAt).toLocaleTimeString() : "—"}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
          <CloudSun className="h-12 w-12 text-gray-600" />
          <p className="text-gray-400 font-medium">No forecast data available</p>
          <p className="text-gray-600 text-sm">Start the bot to begin fetching NWS forecasts for all active cities.</p>
        </div>
      )}
    </div>
  );
}