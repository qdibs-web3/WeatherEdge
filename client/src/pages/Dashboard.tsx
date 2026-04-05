import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, DollarSign, Activity, CloudSun, Bot, BarChart3,
  ArrowRight, Zap, Target, ExternalLink, ArrowUp, ArrowDown, Thermometer,
  ShieldCheck, Clock, CheckCircle2, XCircle, Minus, Radio
} from "lucide-react";
import { toast } from "sonner";

const KALSHI_ACTIVITY_URL = "https://kalshi.com/account/activity";

function strikeFromTicker(ticker: string | null): string {
  if (!ticker) return "—";
  const parts = ticker.split("-");
  if (parts.length < 3) return "—";
  const strike = parts[parts.length - 1];
  if (strike.startsWith("T")) return `>${strike.slice(1)}°F`;
  if (strike.startsWith("B")) return `<${strike.slice(1)}°F`;
  return strike;
}

function kalshiMarketUrl(ticker: string, cityName: string) {
  const parts = ticker?.split("-") ?? [];
  const series = parts[0]?.toLowerCase() ?? "";
  const event = parts.length >= 2 ? parts.slice(0, 2).join("-").toLowerCase() : ticker.toLowerCase();
  const slug = cityName.toLowerCase().replace(/\s+/g, "-") + "-max-daily-temperature";
  return `https://kalshi.com/markets/${series}/${slug}/${event}`;
}

function isLowMarket(ticker: string) {
  return ticker?.toUpperCase().startsWith("KXLOWT");
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function StatCard({ title, value, sub, icon: Icon, color = "blue", trend }: any) {
  const colorMap: Record<string, string> = {
    green: "text-green-400 bg-green-500/10",
    red: "text-red-400 bg-red-500/10",
    blue: "text-blue-400 bg-blue-500/10",
    yellow: "text-yellow-400 bg-yellow-500/10",
    purple: "text-purple-400 bg-purple-500/10",
    cyan: "text-cyan-400 bg-cyan-500/10",
  };
  const [textCls, bgCls] = (colorMap[color] ?? colorMap.blue).split(" ");
  return (
    <Card className="bg-[#18181b] border-[#27272a]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 mb-1 truncate">{title}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg ${bgCls} flex items-center justify-center shrink-0 ml-2`}>
            <Icon className={`h-4 w-4 ${textCls}`} />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`mt-2 flex items-center gap-1 text-xs ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
            {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend >= 0 ? "+" : ""}{trend.toFixed(1)}% today
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { data: status, refetch: refetchStatus } = trpc.bot.getStatus.useQuery(undefined, { refetchInterval: 5000 });
  const { data: stats } = trpc.bot.getTradeStats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: recentTrades } = trpc.bot.getTrades.useQuery({ limit: 10, offset: 0 }, { refetchInterval: 15000 });
  const { data: openTrades } = trpc.bot.getOpenTrades.useQuery(undefined, { refetchInterval: 10000 });
  const { data: balance } = trpc.config.getKalshiBalance.useQuery(undefined, { refetchInterval: 60000 });
  const { data: forecasts } = trpc.bot.getForecasts.useQuery(undefined, { refetchInterval: 300000 });

  const startMutation = trpc.bot.start.useMutation({
    onSuccess: () => { toast.success("Bot started!"); refetchStatus(); },
    onError: (e) => toast.error(e.message),
  });
  const stopMutation = trpc.bot.stop.useMutation({
    onSuccess: () => { toast.success("Bot stopped."); refetchStatus(); },
    onError: (e) => toast.error(e.message),
  });
  const scanMutation = trpc.bot.triggerScan.useMutation({
    onSuccess: (d) => toast.success(`Scan complete — ${d.signals.length} signal(s) found`),
    onError: (e) => toast.error(e.message),
  });

  const balanceAmt = balance ? ((balance as any).balance ?? 0) / 100 : 0;
  const totalPnl = stats ? stats.totalPnl : 0;
  const winRate = stats ? (stats.winRate * 100).toFixed(1) : "—";
  const openAtRisk = (openTrades ?? []).reduce((sum: number, t: any) => sum + parseFloat(t.costBasis ?? 0), 0);
  const scanMode = (status as any)?.scanMode ?? "idle";
  const dailyTradeCount = (status as any)?.dailyTradeCount ?? 0;
  const tradesThisSession = (status as any)?.tradesThisSession ?? 0;

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400">Kalshi Weather Trading — NWS Forecast Edge Strategy</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white" onClick={() => scanMutation.mutate()} disabled={!status?.running || scanMutation.isPending}>
            <Zap className="h-3.5 w-3.5 mr-1.5" />{scanMutation.isPending ? "Scanning..." : "Scan Now"}
          </Button>
          {status?.running ? (
            <Button size="sm" variant="destructive" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
              Stop Bot
            </Button>
          ) : (
            <Button size="sm" className="bg-green-600 hover:bg-green-500" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
              <Bot className="h-3.5 w-3.5 mr-1.5" /> Start Bot
            </Button>
          )}
        </div>
      </div>

      {/* Status Banner */}
      {status?.dryRun && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2.5 flex items-center gap-2">
          <Activity className="h-4 w-4 text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-300">
            <span className="font-semibold">Paper Trading Mode</span> — No real money is being risked. Go to Settings to enable live trading.
          </p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard title="Kalshi Balance" value={`$${balanceAmt.toFixed(2)}`} icon={DollarSign} color="green" />
        <StatCard title="Total P&L" value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`} icon={TrendingUp} color={totalPnl >= 0 ? "green" : "red"} />
        <StatCard title="Total Wagered" value={`$${(stats?.totalWagered ?? 0).toFixed(2)}`} sub="all-time stakes" icon={DollarSign} color="yellow" />
        <StatCard title="Win Rate" value={`${winRate}%`} sub={`${stats?.wins ?? 0}W / ${stats?.losses ?? 0}L`} icon={Target} color="blue" />
        <StatCard title="Open Positions" value={openTrades?.length ?? 0} sub={`$${openAtRisk.toFixed(2)} at risk`} icon={Activity} color="purple" />
      </div>

      {/* Row 2: Bot Status + Open Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Bot Status */}
        <Card className="bg-[#18181b] border-[#27272a] lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-400" /> Bot Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Status</span>
              <Badge className={status?.running ? "bg-green-500/20 text-green-400 border-green-500/30 text-xs" : "bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs"}>
                <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${status?.running ? "bg-green-400 animate-pulse" : "bg-gray-500"}`} />
                {status?.running ? "Running" : "Stopped"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Mode</span>
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className={`text-xs ${status?.dryRun ? "border-yellow-500/40 text-yellow-400" : "border-green-500/40 text-green-400"}`}>
                  {status?.dryRun ? "Paper" : "Live"}
                </Badge>
                {scanMode !== "idle" && (
                  <Badge variant="outline" className={`text-xs ${scanMode === "high-freq" ? "border-blue-500/40 text-blue-400" : "border-gray-500/40 text-gray-400"}`}>
                    <Radio className="h-2.5 w-2.5 mr-1" />{scanMode}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Last Scan</span>
              <span className="text-xs text-white flex items-center gap-1">
                <Clock className="h-3 w-3 text-gray-500" />
                {status?.lastScanAt ? new Date(status.lastScanAt).toLocaleTimeString() : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Trades Today</span>
              <span className="text-xs text-white font-semibold">{dailyTradeCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">This Session</span>
              <span className="text-xs text-white">{tradesThisSession} trades placed</span>
            </div>

            {/* P&L summary */}
            <div className="grid grid-cols-3 gap-1.5 pt-0.5">
              <div className="bg-[#27272a] rounded p-2 text-center">
                <p className="text-[10px] text-gray-500">Won</p>
                <p className="text-xs font-bold text-green-400">{stats?.wins ?? 0}</p>
              </div>
              <div className="bg-[#27272a] rounded p-2 text-center">
                <p className="text-[10px] text-gray-500">Open</p>
                <p className="text-xs font-bold text-yellow-400">{openTrades?.length ?? 0}</p>
              </div>
              <div className="bg-[#27272a] rounded p-2 text-center">
                <p className="text-[10px] text-gray-500">Lost</p>
                <p className="text-xs font-bold text-red-400">{stats?.losses ?? 0}</p>
              </div>
            </div>

            {status?.errorMessage && (
              <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                <p className="text-xs text-red-400">{status.errorMessage}</p>
              </div>
            )}
            <Button variant="outline" size="sm" className="w-full border-[#27272a] text-gray-300 hover:text-white text-xs h-7" onClick={() => setLocation("/bot")}>
              Bot Control <ArrowRight className="h-3 w-3 ml-1.5" />
            </Button>
          </CardContent>
        </Card>

        {/* Open Positions */}
        <Card className="bg-[#18181b] border-[#27272a] lg:col-span-3">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-purple-400" /> Open Positions
                {(openTrades?.length ?? 0) > 0 && (
                  <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">{openTrades?.length}</Badge>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white h-6 px-2 text-xs" onClick={() => setLocation("/trades")}>
                All <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {(openTrades?.length ?? 0) > 0 ? (
              <div>
                {(openTrades ?? []).slice(0, 7).map((t: any) => {
                  const low = isLowMarket(t.marketTicker ?? "");
                  const projTemp = low ? (t.blendedLowTemp ?? t.lowTemp) : (t.blendedHighTemp ?? t.highTemp ?? t.projectedTemp);
                  const strike = strikeFromTicker(t.marketTicker);
                  const stake = parseFloat(t.costBasis ?? 0);
                  const edgePct = t.modelEdge != null ? `${(parseFloat(t.modelEdge) * 100).toFixed(0)}%` : null;
                  const convPct = t.modelProb != null ? `${(parseFloat(t.modelProb) * 100).toFixed(0)}%` : null;
                  return (
                    <div key={t.id} className="flex items-center gap-2 px-4 py-1.5 border-b border-[#27272a] last:border-0 hover:bg-[#27272a]/30">
                      <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                      {/* City + badges */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs text-white font-medium">{t.cityName}</span>
                          <Badge variant="outline" className={`text-[10px] py-0 px-1 h-4 ${t.side === "yes" ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}`}>
                            {t.side?.toUpperCase()}
                          </Badge>
                          {low && <Badge variant="outline" className="text-[10px] py-0 px-1 h-4 border-cyan-500/40 text-cyan-400">LOW</Badge>}
                          <span className="text-[10px] text-gray-500">{strike}</span>
                          <span className="text-[10px] text-gray-600">{t.contracts}× @ {t.priceCents}¢</span>
                        </div>
                      </div>
                      {/* Temp + stats */}
                      <div className="text-right shrink-0 space-y-0">
                        <div className="flex items-center gap-2 justify-end">
                          {projTemp != null && (
                            <span className="text-[10px] text-blue-300 flex items-center gap-0.5">
                              <Thermometer className="h-2.5 w-2.5" />{low ? "L" : "H"} {projTemp}°
                            </span>
                          )}
                          <span className="text-xs text-gray-300 font-medium">${stake.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                          {edgePct && <span className="text-[10px] text-emerald-400">edge {edgePct}</span>}
                          {convPct && <span className="text-[10px] text-gray-500">conf {convPct}</span>}
                          {t.marketTicker && (
                            <a href={kalshiMarketUrl(t.marketTicker, t.cityName)} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-400">
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(openTrades?.length ?? 0) > 7 && (
                  <p className="text-[10px] text-gray-500 px-4 py-2">
                    +{(openTrades?.length ?? 0) - 7} more — <button className="text-blue-400 hover:underline" onClick={() => setLocation("/trades")}>view all</button>
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm px-4">
                No open positions. {status?.running ? "Bot is scanning for opportunities." : "Start the bot to begin trading."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Live Forecasts */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <CloudSun className="h-4 w-4 text-cyan-400" /> Live NWS Forecasts
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white h-6 px-2 text-xs" onClick={() => setLocation("/forecasts")}>
              Full Detail <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {forecasts && forecasts.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {forecasts.slice(0, 10).map((f: any) => {
                const todayDate = fmtDate(f.forecastDate);
                const tomDate = fmtDate(f.tomorrowForecastDate);
                const updatedMin = f.updatedAt ? Math.round((Date.now() - new Date(f.updatedAt).getTime()) / 60000) : null;
                return (
                  <div key={f.cityCode} className="bg-[#27272a] rounded-lg p-2.5 space-y-2">
                    <div className="flex items-start justify-between">
                      <p className="text-xs text-gray-300 font-medium leading-tight truncate pr-1">{f.cityName}</p>
                      {updatedMin != null && (
                        <span className="text-[9px] text-gray-600 shrink-0">{updatedMin}m ago</span>
                      )}
                    </div>

                    {/* Today */}
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-gray-600 font-medium">{todayDate}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <ArrowUp className="h-3 w-3 text-orange-400" />
                          <span className="text-sm font-bold text-white">
                            {f.highTemp != null ? `${f.highTemp}°` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ArrowDown className="h-3 w-3 text-blue-400" />
                          <span className="text-sm font-bold text-blue-300">
                            {f.lowTemp != null ? `${f.lowTemp}°` : "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Tomorrow */}
                    <div className="border-t border-[#3f3f46] pt-1.5 space-y-0.5">
                      <p className="text-[10px] text-gray-600 font-medium">{tomDate}</p>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <ArrowUp className="h-3 w-3 text-orange-300/60" />
                          <span className="text-sm font-bold text-gray-300">
                            {f.tomorrowHigh != null ? `${f.tomorrowHigh}°` : "—"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <ArrowDown className="h-3 w-3 text-blue-300/60" />
                          <span className="text-sm font-bold text-blue-400/70">
                            {f.tomorrowLow != null ? `${f.tomorrowLow}°` : "—"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Conditions */}
                    <p className="text-[10px] text-gray-600 truncate leading-tight">{f.shortForecast ?? "—"}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500 text-sm">No forecast data. Start the bot to fetch forecasts.</div>
          )}
        </CardContent>
      </Card>

      {/* Row 4: Recent Trades */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" /> Recent Trades
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white h-6 px-2 text-xs" onClick={() => setLocation("/trades")}>
              View All <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {recentTrades && recentTrades.length > 0 ? (
            <div>
              {recentTrades.map((t: any) => {
                const stake = parseFloat(t.costBasis ?? 0);
                const evPct = t.evCents != null ? parseFloat(t.evCents).toFixed(1) : null;
                const edgePct = t.modelEdge != null ? `${(parseFloat(t.modelEdge) * 100).toFixed(0)}%` : null;
                const low = isLowMarket(t.marketTicker ?? "");
                const StatusIcon = t.won === true ? CheckCircle2 : t.won === false ? XCircle : Minus;
                const statusColor = t.won === true ? "text-green-400" : t.won === false ? "text-red-400" : "text-yellow-400";
                const pnlColor = t.pnl > 0 ? "text-green-400" : t.pnl < 0 ? "text-red-400" : "text-gray-400";
                const projTemp = low ? (t.blendedLowTemp ?? t.lowTemp) : (t.blendedHighTemp ?? t.highTemp ?? t.projectedTemp);
                return (
                  <div key={t.id} className="flex items-center gap-2 px-4 py-1.5 border-b border-[#27272a] last:border-0 hover:bg-[#27272a]/30">
                    <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusColor}`} />
                    {/* City + details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-xs text-white font-medium">{t.cityName}</span>
                        <Badge variant="outline" className={`text-[10px] py-0 px-1 h-4 ${t.side === "yes" ? "border-green-500/40 text-green-400" : "border-red-500/40 text-red-400"}`}>
                          {t.side?.toUpperCase()}
                        </Badge>
                        {low && <Badge variant="outline" className="text-[10px] py-0 px-1 h-4 border-cyan-500/40 text-cyan-400">LOW</Badge>}
                        {t.isPaper && <span className="text-[10px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded px-1">paper</span>}
                        <span className="text-[10px] text-gray-500">{t.strikeDesc ?? strikeFromTicker(t.marketTicker)}</span>
                        <span className="text-[10px] text-gray-600">{t.contracts}× @ {t.priceCents}¢</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-600">${stake.toFixed(2)} at risk</span>
                        {evPct && <span className="text-[10px] text-blue-400">EV +{evPct}¢</span>}
                        {edgePct && <span className="text-[10px] text-emerald-400">edge {edgePct}</span>}
                        {projTemp != null && (
                          <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
                            <Thermometer className="h-2.5 w-2.5" />{low ? "L" : "H"} {projTemp}°
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Right: P&L + date */}
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold ${pnlColor}`}>
                        {t.pnl != null ? `${t.pnl > 0 ? "+" : ""}$${parseFloat(t.pnl).toFixed(2)}` : "open"}
                      </p>
                      <div className="flex items-center gap-1.5 justify-end">
                        <p className="text-[10px] text-gray-600">{new Date(t.createdAt).toLocaleDateString()}</p>
                        {t.marketTicker && (
                          <a href={t.won == null ? kalshiMarketUrl(t.marketTicker, t.cityName) : KALSHI_ACTIVITY_URL} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-400">
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">No trades yet. Start the bot to begin trading.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
