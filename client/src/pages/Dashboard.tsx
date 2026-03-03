import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, DollarSign, Activity, CloudSun, Bot, BarChart3, ArrowRight, Zap, Target } from "lucide-react";
import { toast } from "sonner";

function StatCard({ title, value, sub, icon: Icon, color = "blue", trend }: any) {
  return (
    <Card className="bg-[#18181b] border-[#27272a]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">{title}</p>
            <p className="text-2xl font-bold text-white">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          </div>
          <div className={`w-9 h-9 rounded-lg bg-${color}-500/10 flex items-center justify-center`}>
            <Icon className={`h-4.5 w-4.5 text-${color}-400`} />
          </div>
        </div>
        {trend !== undefined && (
          <div className={`mt-2 flex items-center gap-1 text-xs ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {trend >= 0 ? '+' : ''}{trend.toFixed(1)}% today
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
  const { data: recentTrades } = trpc.bot.getTrades.useQuery({ limit: 5, offset: 0 }, { refetchInterval: 15000 });
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

  const winRate = stats ? (stats.winRate * 100).toFixed(1) : "—";
  const totalPnl = stats ? stats.totalPnl : 0;
  const balanceAmt = balance ? ((balance as any).balance ?? 0) / 100 : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-gray-400">Kalshi Weather Trading — NWS Forecast Edge Strategy</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="border-[#27272a] text-gray-300 hover:text-white" onClick={() => scanMutation.mutate()} disabled={!status?.running || scanMutation.isPending}>
            <Zap className="h-3.5 w-3.5 mr-1.5" /> Scan Now
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
          <p className="text-sm text-yellow-300"><span className="font-semibold">Paper Trading Mode</span> — No real money is being risked. Go to Settings to enable live trading.</p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Kalshi Balance" value={`$${balanceAmt.toFixed(2)}`} icon={DollarSign} color="green" />
        <StatCard title="Total P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} icon={TrendingUp} color={totalPnl >= 0 ? "green" : "red"} />
        <StatCard title="Win Rate" value={`${winRate}%`} sub={`${stats?.wins ?? 0}W / ${stats?.losses ?? 0}L`} icon={Target} color="blue" />
        <StatCard title="Open Positions" value={openTrades?.length ?? 0} sub={`${stats?.total ?? 0} total trades`} icon={Activity} color="purple" />
      </div>

      {/* Bot Status + Forecasts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bot Status Card */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-400" /> Bot Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Status</span>
              <Badge className={status?.running ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
                <div className={`w-1.5 h-1.5 rounded-full mr-1.5 ${status?.running ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
                {status?.running ? 'Running' : 'Stopped'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Mode</span>
              <Badge variant="outline" className={status?.dryRun ? "border-yellow-500/40 text-yellow-400" : "border-green-500/40 text-green-400"}>
                {status?.dryRun ? 'Paper' : 'Live'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Last Scan</span>
              <span className="text-sm text-white">{status?.lastScanAt ? new Date(status.lastScanAt).toLocaleTimeString() : '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">Signals Found</span>
              <span className="text-sm text-white">{status?.signalsFound ?? 0}</span>
            </div>
            {status?.errorMessage && (
              <div className="bg-red-500/10 border border-red-500/20 rounded p-2">
                <p className="text-xs text-red-400">{status.errorMessage}</p>
              </div>
            )}
            <Button variant="outline" size="sm" className="w-full border-[#27272a] text-gray-300 hover:text-white mt-1" onClick={() => setLocation("/bot")}>
              Bot Control <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </CardContent>
        </Card>

        {/* Live Forecasts Preview */}
        <Card className="bg-[#18181b] border-[#27272a] lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <CloudSun className="h-4 w-4 text-cyan-400" /> Live NWS Forecasts
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white h-7 px-2 text-xs" onClick={() => setLocation("/forecasts")}>
                View All <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {forecasts && forecasts.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {forecasts.slice(0, 6).map((f: any) => (
                  <div key={f.cityCode} className="bg-[#27272a] rounded-lg p-2.5">
                    <p className="text-xs text-gray-400 truncate">{f.cityName}</p>
                    <p className="text-lg font-bold text-white">{f.highTemp}°F</p>
                    <p className="text-xs text-gray-500 truncate">{f.shortForecast}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-gray-500 text-sm">No forecast data yet. Start the bot to fetch forecasts.</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Trades */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-400" /> Recent Trades
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white h-7 px-2 text-xs" onClick={() => setLocation("/trades")}>
              View All <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recentTrades && recentTrades.length > 0 ? (
            <div className="space-y-2">
              {recentTrades.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between py-2 border-b border-[#27272a] last:border-0">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${t.won === true ? 'bg-green-400' : t.won === false ? 'bg-red-400' : 'bg-yellow-400'}`} />
                    <div>
                      <p className="text-sm text-white font-medium">{t.cityName}</p>
                      <p className="text-xs text-gray-500">{t.strikeDesc} · {t.side?.toUpperCase()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${t.pnl > 0 ? 'text-green-400' : t.pnl < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                      {t.pnl != null ? `${t.pnl > 0 ? '+' : ''}$${parseFloat(t.pnl).toFixed(2)}` : '—'}
                    </p>
                    <p className="text-xs text-gray-500">{new Date(t.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">No trades yet. Start the bot to begin trading.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
