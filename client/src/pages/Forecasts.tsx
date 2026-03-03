import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CloudSun, RefreshCw, Thermometer, TrendingUp, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function Forecasts() {
  const { data: forecasts, isLoading, refetch, isFetching } = trpc.bot.getForecasts.useQuery(
    undefined,
    { refetchInterval: 300_000 }
  );
  const { data: signals } = trpc.bot.getLatestSignals.useQuery(undefined, { refetchInterval: 60_000 });

  const signalMap = new Map((signals ?? []).map((s: any) => [s.cityCode, s]));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Live Forecasts</h1>
          <p className="text-sm text-gray-400">NWS forecast data for all 19 active cities — updates every 5 minutes</p>
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
              <CardContent className="p-4 h-32" />
            </Card>
          ))}
        </div>
      ) : forecasts && forecasts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forecasts.map((f: any) => {
            const signal = signalMap.get(f.cityCode);
            const hasSignal = !!signal;
            return (
              <Card
                key={f.cityCode}
                className={`bg-[#18181b] border-[#27272a] transition-all ${hasSignal ? "border-blue-500/40 shadow-[0_0_20px_rgba(59,130,246,0.1)]" : ""}`}
              >
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold text-white">{f.cityName}</CardTitle>
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
                  <div className="flex items-end gap-2">
                    <div className="flex items-center gap-1.5">
                      <Thermometer className="h-4 w-4 text-orange-400" />
                      <span className="text-3xl font-bold text-white">{f.highTemp != null ? Math.round(Number(f.highTemp)) : "—"}°</span>
                      <span className="text-sm text-gray-400">F</span>
                    </div>
                    <div className="pb-1">
                      <span className="text-xs text-gray-500">NWS High</span>
                    </div>
                  </div>

                  <p className="text-xs text-gray-400">{f.shortForecast}</p>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Model Sigma</span>
                    <span className="text-gray-300">{f.sigma != null ? `±${Number(f.sigma).toFixed(1)}°F` : "—"}</span>
                  </div>

                  {hasSignal && signal && (
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-2.5 space-y-1">
                      <p className="text-xs font-medium text-blue-300">Active Signal</p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">Market</span>
                        <span className="text-gray-300 font-mono">{signal.marketTicker}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">Side</span>
                        <Badge variant="outline" className={signal.side === "yes" ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}>
                          {signal.side?.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">EV Edge</span>
                        <span className="text-blue-300 font-semibold">+{signal.evCents != null ? Number(signal.evCents).toFixed(1) : "0.0"}¢</span>
                      </div>
                    </div>
                  )}

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
          <p className="text-gray-600 text-sm">Start the bot to begin fetching NWS forecasts for all 19 cities.</p>
        </div>
      )}
    </div>
  );
}
