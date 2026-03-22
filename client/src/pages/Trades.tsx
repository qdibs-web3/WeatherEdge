import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter, RefreshCw, ExternalLink } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const PAGE_SIZE = 20;

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
  // e.g. KXHIGHTLV-26MAR08-T68 + "Las Vegas"
  // → https://kalshi.com/markets/kxhightlv/las-vegas-max-daily-temperature/kxhightlv-26mar08
  const parts = ticker?.split("-") ?? [];
  const series = parts[0]?.toLowerCase() ?? "";
  const event = parts.length >= 2 ? parts.slice(0, 2).join("-").toLowerCase() : ticker.toLowerCase();
  const slug = cityName.toLowerCase().replace(/\s+/g, "-") + "-max-daily-temperature";
  return `https://kalshi.com/markets/${series}/${slug}/${event}`;
}

type TradeMode = "paper" | "live" | "all";

export default function Trades() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openPositionsExpanded, setOpenPositionsExpanded] = useState(true);
  const [mode, setMode] = useState<TradeMode>("paper");

  const { data: trades, isLoading, refetch } = trpc.bot.getTrades.useQuery(
    { limit: PAGE_SIZE, offset: page * PAGE_SIZE, mode },
    { refetchInterval: 15000 }
  );
  const { data: stats, refetch: refetchStats } = trpc.bot.getTradeStats.useQuery({ mode }, { refetchInterval: 30000 });
  const { data: openTrades } = trpc.bot.getOpenTrades.useQuery({ mode }, { refetchInterval: 10000 });
  const { data: dailyPnl, refetch: refetchDailyPnl } = trpc.bot.getDailyPnl.useQuery({ days: 30, mode }, { refetchInterval: 60000 });
  const recalcMutation = trpc.bot.recalculatePnl.useMutation({
    onSuccess: (data) => {
      refetch(); refetchStats(); refetchDailyPnl();
      alert(`P&L recalculated for ${data.count} trades.`);
    },
  });

  const filtered = (trades ?? []).filter((t: any) => {
    const matchSearch = !search || t.cityName?.toLowerCase().includes(search.toLowerCase()) || t.marketTicker?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || (statusFilter === "open" && t.won == null) || (statusFilter === "won" && t.won === true) || (statusFilter === "lost" && t.won === false);
    return matchSearch && matchStatus;
  });

  const totalPnl = stats?.totalPnl ?? 0;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const winRate = (stats?.winRate ?? 0) * 100;
  const openCount = openTrades?.length ?? 0;
  const totalTrades = stats?.total ?? 0;

  // Build cumulative P&L series for chart
  const chartData = (dailyPnl ?? []).reduce<{ date: string; cumPnl: number }[]>((acc, d: any) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].cumPnl : 0;
    acc.push({ date: d.date.slice(5), cumPnl: parseFloat((prev + d.pnl).toFixed(2)) });
    return acc;
  }, []);
  const chartPositive = chartData.length === 0 || chartData[chartData.length - 1]?.cumPnl >= 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Trade History</h1>
          <p className="text-sm text-gray-400">Kalshi weather market trades</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Paper / Live / All toggle */}
          <div className="flex rounded-md border border-[#27272a] overflow-hidden">
            {(["paper", "live", "all"] as TradeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setPage(0); }}
                className={`px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                  mode === m
                    ? m === "paper" ? "bg-purple-500/20 text-purple-300" : m === "live" ? "bg-green-500/20 text-green-300" : "bg-blue-500/20 text-blue-300"
                    : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="border-[#27272a] text-gray-300 hover:text-white" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          <Button variant="outline" size="sm" className="border-purple-500/40 text-purple-300 hover:text-purple-200" onClick={() => recalcMutation.mutate()} disabled={recalcMutation.isPending}>
            {recalcMutation.isPending ? "Recalculating…" : "Recalc P&L"}
          </Button>
        </div>
      </div>

      {/* Summary Stats — 4 boxes */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Win Rate with W/L ratio */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Win Rate</p>
            <p className="text-xl font-bold text-blue-400">{winRate.toFixed(1)}%</p>
            <p className="text-xs text-gray-500 mt-0.5">{wins}W / {losses}L</p>
          </CardContent>
        </Card>

        {/* Total P&L */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total P&L</p>
            <p className={`text-xl font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </p>
          </CardContent>
        </Card>

        {/* Trades + Open combined */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Trades</p>
            <p className="text-xl font-bold text-white">{totalTrades}</p>
            <p className="text-xs text-yellow-400 mt-0.5">{openCount} open</p>
          </CardContent>
        </Card>

        {/* Cumulative P&L Sparkline */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 mb-1">P&L Curve</p>
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={52}>
                <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={chartPositive ? "#22c55e" : "#ef4444"} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={chartPositive ? "#22c55e" : "#ef4444"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="cumPnl"
                    stroke={chartPositive ? "#22c55e" : "#ef4444"}
                    strokeWidth={1.5}
                    fill="url(#pnlGrad)"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, fontSize: 11 }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(v: any) => [`$${Number(v).toFixed(2)}`, "P&L"]}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-gray-600 pt-2">No data yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Open Positions */}
      {openTrades && openTrades.length > 0 && (
        <Card className="bg-[#18181b] border-[#27272a] border-yellow-500/20">
          <CardHeader className="pb-3 cursor-pointer" onClick={() => setOpenPositionsExpanded(e => !e)}>
            <CardTitle className="text-sm font-semibold text-yellow-400 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" /> Open Positions ({openTrades.length})
              </div>
              <span className="text-gray-500 text-xs font-normal">{openPositionsExpanded ? "▲ collapse" : "▼ expand"}</span>
            </CardTitle>
          </CardHeader>
          {openPositionsExpanded && (
          <CardContent>
            <div className="space-y-2">
              {openTrades.map((t: any) => {
                const stake = parseFloat(t.costBasis ?? 0);
                // Net profit if YES wins: (gross win per contract) × (1 - 7% fee) × contracts
                const netProfit = t.contracts * (100 - t.priceCents) * 0.93 / 100;
                return (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-[#27272a]">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-white">{t.cityName}</p>
                      {t.marketTicker && (
                        <a href={kalshiMarketUrl(t.marketTicker, t.cityName)} target="_blank" rel="noopener noreferrer" className="text-gray-600 hover:text-blue-400 transition-colors">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">{t.strikeDesc ?? strikeFromTicker(t.marketTicker)} · {t.side?.toUpperCase()} · {t.contracts} × {t.priceCents}¢</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white font-medium">Stake ${stake.toFixed(2)}</p>
                    <p className="text-xs text-green-400">Win +${netProfit.toFixed(2)} <span className="text-gray-600">/ Lose -${stake.toFixed(2)}</span></p>
                    <p className="text-xs text-gray-600">{new Date(t.createdAt).toLocaleString()}</p>
                  </div>
                </div>
                );
              })}
            </div>
          </CardContent>
          )}
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <Input placeholder="Search city or ticker..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-[#18181b] border-[#27272a] text-white placeholder:text-gray-500" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 bg-[#18181b] border-[#27272a] text-gray-300">
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#18181b] border-[#27272a]">
            <SelectItem value="all">All Trades</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="won">Won</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Trade Table */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading trades...</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">No trades found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#27272a]">
                    {["City", "Market", "Side", "Contracts", "Entry", "Exit", "P&L", "Status", "Date"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t: any) => {
                    const pnl = parseFloat(t.pnl ?? 0);
                    return (
                      <tr key={t.id} className="border-b border-[#27272a] hover:bg-[#27272a]/50 transition-colors">
                        <td className="px-4 py-3 text-white font-medium">{t.cityName}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <p className="text-sm text-gray-300">{t.strikeDesc ?? strikeFromTicker(t.marketTicker)}</p>
                              <p className="text-xs text-gray-600 font-mono">{t.marketTicker}</p>
                            </div>
                            {t.marketTicker && (
                              <a
                                href={t.won == null ? kalshiMarketUrl(t.marketTicker, t.cityName) : KALSHI_ACTIVITY_URL}
                                target="_blank" rel="noopener noreferrer"
                                className="text-gray-600 hover:text-blue-400 transition-colors"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={t.side === 'yes' ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'}>
                            {t.side?.toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{t.contracts}</td>
                        <td className="px-4 py-3 text-gray-300">{t.priceCents != null ? `${t.priceCents}¢` : '—'}</td>
                        <td className="px-4 py-3 text-gray-300">{t.settlementValue != null ? `$${parseFloat(t.settlementValue).toFixed(2)}` : '—'}</td>
                        <td className={`px-4 py-3 font-semibold ${pnl > 0 ? 'text-green-400' : pnl < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                          {t.pnl != null ? `${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {t.won === true ? (
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Won</Badge>
                            ) : t.won === false ? (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Lost</Badge>
                            ) : (
                              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Open</Badge>
                            )}
                            {t.isPaper && (
                              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Paper</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Page {page + 1}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="border-[#27272a] text-gray-300" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
          <Button variant="outline" size="sm" className="border-[#27272a] text-gray-300" onClick={() => setPage(p => p + 1)} disabled={(trades?.length ?? 0) < PAGE_SIZE}>Next</Button>
        </div>
      </div>
    </div>
  );
}
