import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CloudSun, RefreshCw, Thermometer, TrendingUp,
  CheckCircle2, Wind, Droplets, ArrowDown, Activity, ChevronDown, ChevronRight
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

  const [expandedEnsemble, setExpandedEnsemble] = useState<Set<string>>(new Set());

  const toggleEnsemble = (cityCode: string) => {
    setExpandedEnsemble(prev => {
      const next = new Set(prev);
      next.has(cityCode) ? next.delete(cityCode) : next.add(cityCode);
      return next;
    });
  };

  const ensembleMap = new Map<string, any>(
    (ensembleData ?? []).map((e: any) => [e.cityCode, e])
  );

  const flatBet = (botConfig as any)?.flatBetDollars ?? 20;
  const KALSHI_FEE_RATE = 0.07;
  const lastSignals: any[] = (botStatus as any)?.lastSignals ?? [];
  const signalMap = new Map(lastSignals.map((s: any) => [s.cityCode, s]));

  const windArrow: Record<string, string> = {
    N: "↑", NNE: "↑", NE: "↗", ENE: "↗",
    E: "→", ESE: "↘", SE: "↘", SSE: "↓",
    S: "↓", SSW: "↓", SW: "↙", WSW: "↙",
    W: "←", WNW: "↖", NW: "↖", NNW: "↑",
  };

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Live Forecasts</h1>
          <p className="text-xs text-gray-500">NWS + 4-model ensemble (Best/GFS/ICON/GEM) · updates every 5 min</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-[#27272a] text-gray-300 hover:text-white h-7 text-xs"
          onClick={() => { refetch(); toast.info("Refreshing forecasts..."); }}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3 w-3 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-[#18181b] border border-[#27272a] rounded-lg animate-pulse h-32" />
          ))}
        </div>
      ) : forecasts && forecasts.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {forecasts.map((f: any) => {
            const signal = signalMap.get(f.cityCode);
            const hasSignal = !!signal;

            // NWS temps (declared first — needed by ensemble blended calcs below)
            const high        = f.highTemp    != null ? Math.round(Number(f.highTemp)    * 10) / 10 : null;
            const low         = f.lowTemp     != null ? Math.round(Number(f.lowTemp)     * 10) / 10 : null;
            const tomorrowHigh = f.tomorrowHigh != null ? Math.round(Number(f.tomorrowHigh) * 10) / 10 : null;
            const tomorrowLow  = f.tomorrowLow  != null ? Math.round(Number(f.tomorrowLow)  * 10) / 10 : null;

            const precip = f.precipChance != null ? Number(f.precipChance) : null;
            const sigma  = f.sigma != null ? Number(f.sigma).toFixed(1) : null;
            const windArrowChar = windArrow[f.windDirection ?? ""] ?? "";

            const todayLabel    = f.forecastDate
              ? new Date(f.forecastDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              : "Today";
            const tomorrowLabel = f.tomorrowForecastDate
              ? new Date(f.tomorrowForecastDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              : "Tomorrow";

            // Ensemble data
            const ensEntry           = ensembleMap.get(f.cityCode);
            const ensemble           = ensEntry?.ensemble           ?? null;
            const tomorrowEnsemble   = ensEntry?.tomorrowEnsemble   ?? null;
            const dayPlusTwoEnsemble = ensEntry?.dayPlusTwoEnsemble ?? null;
            const ensBias            = ensEntry?.directionBias ?? 0;
            const ensDateLabel = ensEntry?.date
              ? new Date(ensEntry.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              : null;
            const tomEnsDateLabel = ensEntry?.tomorrowDate
              ? new Date(ensEntry.tomorrowDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              : null;
            const d2EnsDateLabel = ensEntry?.dayPlusTwoDate
              ? new Date(ensEntry.dayPlusTwoDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
              : null;

            // Blend helper: NWS 40% + ensemble 60%; falls back to NWS-only
            function calcBlend(nws: number | null, ens: any | null, bias: number): number | null {
              if (nws == null) return null;
              if (!ens || ens.modelCount < 1) return Math.round((nws + bias) * 10) / 10;
              return Math.round((nws * 0.40 + ens.consensus * 0.60 + bias) * 10) / 10;
            }

            // Today ensemble calcs
            const spreadBad   = ensemble && ensemble.spread > 6;
            const spreadWarn  = ensemble && ensemble.spread > 3 && ensemble.spread <= 6;
            const blendedForecast = calcBlend(high, ensemble, ensBias);
            const nwsVsDelta = high != null && ensemble
              ? Math.round((ensemble.consensus - high) * 10) / 10 : null;

            // Tomorrow ensemble calcs
            const tomSpreadBad  = tomorrowEnsemble && tomorrowEnsemble.spread > 6;
            const tomSpreadWarn = tomorrowEnsemble && tomorrowEnsemble.spread > 3 && tomorrowEnsemble.spread <= 6;
            const blendedTomorrow = calcBlend(tomorrowHigh, tomorrowEnsemble, ensBias) ?? tomorrowHigh;
            const tomNwsVsDelta = tomorrowHigh != null && tomorrowEnsemble
              ? Math.round((tomorrowEnsemble.consensus - tomorrowHigh) * 10) / 10 : null;

            const updatedMin  = f.updatedAt ? Math.round((Date.now() - new Date(f.updatedAt).getTime()) / 60000) : null;
            const ensExpanded = expandedEnsemble.has(f.cityCode);

            // Signal economics
            let signalBlock = null;
            if (hasSignal && signal) {
              const ev: number = signal.ev ?? 0;
              const contracts: number = signal.contracts ?? Math.floor(flatBet / (signal.priceCents / 100));
              const grossWin = 100 - signal.priceCents;
              const netWin = grossWin * (1 - KALSHI_FEE_RATE);
              const expectedProfit = (signal.ourProb * netWin - (1 - signal.ourProb) * signal.priceCents) * contracts / 100;
              signalBlock = (
                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-2 space-y-1">
                  <div className="flex items-center gap-1">
                    <Activity className="h-2.5 w-2.5 text-blue-400" />
                    <span className="text-[10px] font-medium text-blue-300">Active Signal</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 text-[10px]">
                    <span className="text-gray-500">Side</span>
                    <span className={`text-right font-bold ${signal.side === "yes" ? "text-green-400" : "text-red-400"}`}>{signal.side?.toUpperCase()}</span>
                    <span className="text-gray-500">Entry</span>
                    <span className="text-gray-300 text-right">{contracts}× @ {signal.priceCents}¢</span>
                    <span className="text-gray-500">EV/contract</span>
                    <span className="text-blue-300 font-semibold text-right">+{ev.toFixed(1)}¢</span>
                    <span className="text-gray-500">Exp. profit</span>
                    <span className={`font-semibold text-right ${expectedProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {expectedProfit >= 0 ? "+" : ""}${expectedProfit.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={f.cityCode}
                className={`bg-[#18181b] border rounded-lg p-3 space-y-2 text-xs ${hasSignal ? "border-blue-500/40 shadow-[0_0_16px_rgba(59,130,246,0.08)]" : "border-[#27272a]"}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between gap-1">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white leading-tight truncate">{f.cityName}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-gray-600">{f.cityCode}</span>
                      {updatedMin != null && <span className="text-[10px] text-gray-700">{updatedMin}m ago</span>}
                    </div>
                  </div>
                  {hasSignal ? (
                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] py-0 px-1.5 shrink-0">
                      <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> Signal
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-[#3f3f46] text-gray-600 text-[10px] py-0 px-1.5 shrink-0">No Signal</Badge>
                  )}
                </div>

                {/* Today / Tomorrow temps side by side */}
                <div className="grid grid-cols-2 gap-1.5">
                  {/* Today */}
                  <div className="bg-[#27272a] rounded px-2 py-1.5">
                    <p className="text-[10px] text-gray-600 mb-1">{todayLabel}</p>
                    <div className="flex items-center gap-1">
                      <Thermometer className="h-3 w-3 text-orange-400 shrink-0" />
                      <span className="text-sm font-bold text-white">{high != null ? `${high.toFixed(0)}°` : "—"}</span>
                    </div>
                    {low != null && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <ArrowDown className="h-2.5 w-2.5 text-blue-400 shrink-0" />
                        <span className="text-xs font-semibold text-blue-300">{low.toFixed(0)}°</span>
                      </div>
                    )}
                    {blendedForecast != null && (
                      <p className="text-[10px] text-purple-400 mt-0.5">≈{blendedForecast}° blend</p>
                    )}
                  </div>
                  {/* Tomorrow */}
                  <div className="bg-[#27272a] rounded px-2 py-1.5">
                    <p className="text-[10px] text-gray-600 mb-1">{tomorrowLabel}</p>
                    <div className="flex items-center gap-1">
                      <Thermometer className="h-3 w-3 text-orange-300/60 shrink-0" />
                      <span className="text-sm font-bold text-gray-300">{tomorrowHigh != null ? `${tomorrowHigh.toFixed(0)}°` : "—"}</span>
                    </div>
                    {tomorrowLow != null && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <ArrowDown className="h-2.5 w-2.5 text-blue-300/60 shrink-0" />
                        <span className="text-xs font-semibold text-blue-400/70">{tomorrowLow.toFixed(0)}°</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Meta row: sigma, precip, wind, conditions */}
                <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-500">
                  {sigma && <span className="text-gray-500">σ±{sigma}°</span>}
                  {precip != null && (
                    <span className="flex items-center gap-0.5 text-blue-400/80">
                      <Droplets className="h-2.5 w-2.5" />{precip}%
                    </span>
                  )}
                  {f.windSpeed && (
                    <span className="flex items-center gap-0.5">
                      <Wind className="h-2.5 w-2.5" />{windArrowChar} {f.windSpeed}
                    </span>
                  )}
                  {f.shortForecast && (
                    <span className="text-gray-600 truncate">{f.shortForecast}</span>
                  )}
                </div>

                {/* Ensemble dropdown */}
                {ensemble && (
                  <div>
                    <button
                      onClick={() => toggleEnsemble(f.cityCode)}
                      className={`w-full flex items-center justify-between px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                        spreadBad  ? "bg-red-500/10 text-red-400 hover:bg-red-500/15" :
                        spreadWarn ? "bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/15" :
                                     "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"
                      }`}
                    >
                      <span>
                        {spreadBad ? "⚠ Disagree" : spreadWarn ? "~ Partial" : "✓ Agree"} ±{ensemble.spread}°
                        {nwsVsDelta !== null && (
                          <span className={`ml-1.5 ${nwsVsDelta > 0 ? "text-orange-400" : nwsVsDelta < 0 ? "text-blue-400" : "text-gray-500"}`}>
                            ens {nwsVsDelta > 0 ? "+" : ""}{nwsVsDelta}° vs NWS
                          </span>
                        )}
                      </span>
                      {ensExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </button>

                    {ensExpanded && (
                      <div className="mt-1 space-y-1.5">
                        {([
                          { label: ensDateLabel,    ens: ensemble,           blended: blendedForecast, delta: nwsVsDelta,    bad: spreadBad,    warn: spreadWarn },
                          { label: tomEnsDateLabel, ens: tomorrowEnsemble,   blended: blendedTomorrow,  delta: tomNwsVsDelta, bad: tomSpreadBad, warn: tomSpreadWarn },
                          { label: d2EnsDateLabel,  ens: dayPlusTwoEnsemble, blended: null,             delta: null,          bad: dayPlusTwoEnsemble && dayPlusTwoEnsemble.spread > 6, warn: dayPlusTwoEnsemble && dayPlusTwoEnsemble.spread > 3 && dayPlusTwoEnsemble.spread <= 6 },
                        ] as const).filter(d => d.ens != null).map((d) => (
                          <div key={d.label ?? "ens"} className={`rounded px-2 py-2 space-y-1.5 border ${
                            d.bad  ? "bg-red-500/5 border-red-500/20" :
                            d.warn ? "bg-yellow-500/5 border-yellow-500/20" :
                                     "bg-emerald-500/5 border-emerald-500/20"
                          }`}>
                            {/* Date + spread */}
                            <div className="flex items-center justify-between text-[10px]">
                              <span className="text-gray-500 font-medium">{d.label ?? "—"}</span>
                              <span className={d.bad ? "text-red-400" : d.warn ? "text-yellow-400" : "text-emerald-400"}>
                                {d.bad ? "⚠" : d.warn ? "~" : "✓"} ±{d.ens!.spread}°
                              </span>
                            </div>
                            {/* 5 model values */}
                            <div className="grid grid-cols-2 gap-1 text-[9px] text-center">
                              <div>
                                <p className="text-emerald-600">Best 30%</p>
                                <p className="text-gray-200 font-medium">{d.ens!.bestMatch != null ? `${(Math.round(d.ens!.bestMatch * 10) / 10).toFixed(1)}°` : "—"}</p>
                              </div>
                              <div>
                                <p className="text-sky-600">GFS 30%</p>
                                <p className="text-gray-200 font-medium">{d.ens!.gfs       != null ? `${(Math.round(d.ens!.gfs       * 10) / 10).toFixed(1)}°` : "—"}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">ICON 25%</p>
                                <p className="text-gray-200 font-medium">{d.ens!.icon      != null ? `${(Math.round(d.ens!.icon      * 10) / 10).toFixed(1)}°` : "—"}</p>
                              </div>
                              <div>
                                <p className="text-gray-500">GEM 15%</p>
                                <p className="text-gray-200 font-medium">{d.ens!.gem       != null ? `${(Math.round(d.ens!.gem       * 10) / 10).toFixed(1)}°` : "—"}</p>
                              </div>
                            </div>
                            {/* Ensemble consensus */}
                            <div className="border-t border-white/5 pt-1 flex items-center justify-between text-[10px]">
                              <span className="text-gray-500">Consensus</span>
                              <div className="text-right">
                                <span className="text-white font-semibold">{d.ens!.consensus}°F</span>
                                {d.delta != null && (
                                  <span className={`ml-1.5 ${d.delta > 0 ? "text-orange-400" : d.delta < 0 ? "text-blue-400" : "text-gray-500"}`}>
                                    ({d.delta > 0 ? "+" : ""}{d.delta}° vs NWS)
                                  </span>
                                )}
                              </div>
                            </div>
                            {/* Final bot blend */}
                            {d.blended != null && (
                              <div className="flex items-center justify-between text-[10px] border-t border-white/5 pt-1">
                                <span className="text-gray-600">Bot blend NWS·Ens{ensBias !== 0 ? ` +${ensBias}°` : ""}</span>
                                <span className="text-purple-300 font-semibold">{d.blended}°F</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Active signal block */}
                {signalBlock}

                {/* Updated time */}
                <div className="flex items-center gap-1 text-[10px] text-gray-700">
                  <CheckCircle2 className="h-2.5 w-2.5" />
                  {f.updatedAt ? new Date(f.updatedAt).toLocaleTimeString() : "—"}
                </div>
              </div>
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
