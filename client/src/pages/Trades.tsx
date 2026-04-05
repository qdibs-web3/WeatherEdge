import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Filter, RefreshCw, ExternalLink, Sparkles, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { AreaChart, Area, Tooltip, ResponsiveContainer } from "recharts";

const PAGE_SIZE = 25;

const KALSHI_ACTIVITY_URL = "https://kalshi.com/account/activity";

function parseDateFromTicker(ticker: string | null): string | null {
  if (!ticker) return null;
  const MONTH_MAP: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const m = ticker.toUpperCase().match(/-(\d{2})([A-Z]{3})(\d{2})(?:-|$)/);
  if (!m) return null;
  const year = 2000 + parseInt(m[1], 10);
  const month = MONTH_MAP[m[2]];
  const day = m[3].padStart(2, "0");
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function getCountdown(ticker: string | null, won: boolean | null): { label: string; urgent: boolean } {
  if (won !== null) return { label: "—", urgent: false };
  const date = parseDateFromTicker(ticker);
  if (!date) return { label: "—", urgent: false };
  // Kalshi HIGH markets settle ~11 PM ET on settlement date; EDT = UTC-4 in April
  const settleMs = new Date(`${date}T23:00:00-04:00`).getTime();
  const diff = settleMs - Date.now();
  if (diff <= 0) return { label: "Resolving", urgent: true };
  const totalMins = Math.floor(diff / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours >= 48) return { label: `${Math.floor(hours / 24)}d ${hours % 24}h`, urgent: false };
  if (hours >= 1)  return { label: `${hours}h ${mins}m`, urgent: hours < 6 };
  return { label: `${mins}m`, urgent: true };
}

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
  const [sideFilter, setSideFilter] = useState("all");
  const [marketTypeFilter, setMarketTypeFilter] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<TradeMode>("paper");

  const toggleRow = (id: number) => setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // Fetch all trades at once — client-side filtering + pagination prevents cross-page split
  const { data: trades, isLoading, refetch } = trpc.bot.getTrades.useQuery(
    { limit: 500, offset: 0, mode },
    { refetchInterval: 15000 }
  );
  const { data: stats, refetch: refetchStats } = trpc.bot.getTradeStats.useQuery({ mode }, { refetchInterval: 30000 });
  const { data: openTrades } = trpc.bot.getOpenTrades.useQuery({ mode }, { refetchInterval: 10000 });
  const { data: forecasts } = trpc.bot.getForecasts.useQuery(undefined, { refetchInterval: 60000 });
  const forecastMap = (forecasts ?? []).reduce((acc: Record<string, any>, f: any) => {
    acc[f.cityCode] = f;
    return acc;
  }, {} as Record<string, any>);
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
    const matchSide = sideFilter === "all" || t.side === sideFilter;
    const isLow = t.marketTicker?.toUpperCase().startsWith("KXLOWT");
    const matchType = marketTypeFilter === "all" || (marketTypeFilter === "high" && !isLow) || (marketTypeFilter === "low" && isLow);
    return matchSearch && matchStatus && matchSide && matchType;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedTrades = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const totalPnl = stats?.totalPnl ?? 0;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const winRate = (stats?.winRate ?? 0) * 100;
  const openCount = openTrades?.length ?? 0;
  const settledTrades = stats?.total ?? 0;
  const totalTrades = settledTrades + openCount;

  const allTimePotentialReturn = stats?.totalPotentialReturn ?? 0;
  const allTimeWagered = stats?.totalWagered ?? 0;
  const allTimePotentialProfit = allTimePotentialReturn - allTimeWagered;

  const openStake = (openTrades ?? []).reduce((sum: number, t: any) => sum + parseFloat(t.costBasis ?? 0), 0);
  const openPotentialProfit = (openTrades ?? []).reduce((sum: number, t: any) => {
    return sum + (Number(t.contracts) * (100 - Number(t.priceCents)) * 0.93) / 100;
  }, 0);
  const openPotentialPayout = openStake + openPotentialProfit;

  // Build cumulative P&L series for chart
  const chartData = (dailyPnl ?? []).reduce<{ date: string; cumPnl: number }[]>((acc, d: any) => {
    const prev = acc.length > 0 ? acc[acc.length - 1].cumPnl : 0;
    acc.push({ date: d.date.slice(5), cumPnl: parseFloat((prev + d.pnl).toFixed(2)) });
    return acc;
  }, []);
  const chartPositive = chartData.length === 0 || chartData[chartData.length - 1]?.cumPnl >= 0;

  return (
    <div className="p-6 space-y-6">
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

      {/* Summary Stats — 6 boxes */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {/* Win Rate */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-5 flex flex-col gap-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Win Rate</p>
            <p className="text-3xl font-bold text-blue-400">{winRate.toFixed(1)}%</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm font-semibold text-green-400">{wins}W</span>
              <span className="text-gray-600">/</span>
              <span className="text-sm font-semibold text-red-400">{losses}L</span>
            </div>
          </CardContent>
        </Card>

        {/* Total P&L */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-5 flex flex-col gap-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total P&L</p>
            <p className={`text-3xl font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              ROI <span className={stats?.roi != null && stats.roi >= 0 ? "text-green-400" : "text-red-400"}>
                {stats?.roi != null ? `${(stats.roi * 100).toFixed(1)}%` : "—"}
              </span>
            </p>
            <div className="border-t border-white/5 pt-2 mt-1 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{wins} wins</span>
                <span className="text-xs font-semibold text-green-400">+${(stats?.totalWinPnl ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">{losses} losses</span>
                <span className="text-xs font-semibold text-red-400">-${Math.abs(stats?.totalLossPnl ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Open Positions */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Open Positions</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-semibold tracking-wide">LIVE</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">At Risk</p>
                <p className="text-lg font-bold text-yellow-400">{openStake > 0 ? `$${openStake.toFixed(2)}` : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">If All Win</p>
                <p className="text-lg font-bold text-emerald-400">{openPotentialProfit > 0 ? `+$${openPotentialProfit.toFixed(2)}` : "—"}</p>
              </div>
            </div>
            <div className="border-t border-white/5 pt-2 mt-1 flex items-center justify-between">
              <span className="text-xs text-gray-500">Total payout</span>
              <span className="text-sm font-bold text-white">{openPotentialPayout > 0 ? `$${openPotentialPayout.toFixed(2)}` : "—"}</span>
            </div>
            <p className="text-xs text-gray-600">{openCount} trade{openCount !== 1 ? "s" : ""} open</p>
          </CardContent>
        </Card>

        {/* All-Time Potential */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">All-Time Potential</p>
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Total Wagered</p>
                <p className="text-lg font-bold text-yellow-400">{allTimeWagered > 0 ? `$${allTimeWagered.toFixed(2)}` : "—"}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">Total Payout</p>
                <p className="text-lg font-bold text-emerald-400">{allTimePotentialReturn > 0 ? `$${allTimePotentialReturn.toFixed(2)}` : "—"}</p>
              </div>
            </div>
            <div className="border-t border-white/5 pt-2 mt-1 flex items-center justify-between">
              <span className="text-xs text-gray-500">Net profit potential</span>
              <span className="text-sm font-bold text-emerald-400">{allTimePotentialProfit > 0 ? `+$${allTimePotentialProfit.toFixed(2)}` : "—"}</span>
            </div>
            <p className="text-xs text-gray-600">{totalTrades} trades · if every trade won</p>
          </CardContent>
        </Card>

        {/* Trades */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-5 flex flex-col gap-1">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Trades</p>
            <p className="text-3xl font-bold text-white">{totalTrades}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-gray-400">{settledTrades} settled</span>
              <span className="text-gray-600">·</span>
              <span className="text-sm font-semibold text-yellow-400">{openCount} open</span>
            </div>
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


      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <Input placeholder="Search city or ticker..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9 bg-[#18181b] border-[#27272a] text-white placeholder:text-gray-500" />
        </div>
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32 bg-[#18181b] border-[#27272a] text-gray-300">
            <Filter className="h-3.5 w-3.5 mr-1.5" /><SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#18181b] border-[#27272a]">
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="won">Won</SelectItem>
            <SelectItem value="lost">Lost</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sideFilter} onValueChange={v => { setSideFilter(v); setPage(0); }}>
          <SelectTrigger className="w-28 bg-[#18181b] border-[#27272a] text-gray-300">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#18181b] border-[#27272a]">
            <SelectItem value="all">All Sides</SelectItem>
            <SelectItem value="yes">YES only</SelectItem>
            <SelectItem value="no">NO only</SelectItem>
          </SelectContent>
        </Select>
        <Select value={marketTypeFilter} onValueChange={v => { setMarketTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-32 bg-[#18181b] border-[#27272a] text-gray-300">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#18181b] border-[#27272a]">
            <SelectItem value="all">All Markets</SelectItem>
            <SelectItem value="high">High Temp</SelectItem>
            <SelectItem value="low">Low Temp</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-gray-600 ml-auto">{filtered.length} trade{filtered.length !== 1 ? "s" : ""}</p>
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
                    <th className="w-8 px-2 py-3" />
                    {["City / Market", "Side", "Position", "Forecast", "Edge", "At Risk", "P&L", "Status", "Resolves", "Date"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedTrades.map((t: any) => {
                    const pnl = parseFloat(t.pnl ?? 0);
                    const stake = parseFloat(t.costBasis ?? 0);
                    const totalReturn = pnl + stake;
                    const potentialWin = t.contracts != null && t.priceCents != null
                      ? (Number(t.contracts) * (100 - Number(t.priceCents)) * 0.93) / 100
                      : null;
                    const potentialPayout = potentialWin != null ? potentialWin + stake : null;
                    const ourProbPct = t.ourProb != null ? Math.round(t.ourProb * 100) : null;
                    const impliedPct = t.priceCents != null ? Number(t.priceCents) : null;
                    const edge = ourProbPct != null && impliedPct != null ? ourProbPct - impliedPct : null;
                    const isLowMkt = t.marketTicker?.toUpperCase().startsWith("KXLOWT");
                    const fc = forecastMap[t.cityCode];
                    const settlementDate = parseDateFromTicker(t.marketTicker);
                    // Format settlement date as "Apr 2" — use noon to avoid UTC midnight rollback
                    const settlementLabel = settlementDate
                      ? new Date(settlementDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "—";
                    const tempKind = isLowMkt ? "low" : "high";
                    const projectedTemp = t.forecastTemp != null
                      ? { temp: t.forecastTemp, label: `${settlementLabel} · blended ${tempKind}` }
                      : fc
                        ? isLowMkt
                          ? settlementDate === fc.forecastDate
                            ? { temp: fc.lowTemp, label: `${settlementLabel} · NWS low` }
                            : { temp: fc.tomorrowLow, label: `${settlementLabel} · NWS low` }
                          : settlementDate === fc.forecastDate
                            ? { temp: fc.highTemp, label: `${settlementLabel} · NWS high` }
                            : { temp: fc.tomorrowHigh, label: `${settlementLabel} · NWS high` }
                        : null;
                    const isExpanded = expandedRows.has(t.id);
                    return (
                      <>
                      <tr
                        key={t.id}
                        onClick={() => toggleRow(t.id)}
                        className="border-b border-[#27272a] hover:bg-[#27272a]/50 transition-colors cursor-pointer select-none"
                      >
                        {/* Expand toggle */}
                        <td className="pl-3 pr-1 py-3 text-gray-600">
                          {isExpanded
                            ? <ChevronDown className="h-3.5 w-3.5" />
                            : <ChevronRight className="h-3.5 w-3.5" />}
                        </td>
                        {/* City / Market */}
                        <td className="px-4 py-3">
                          <p className="text-sm font-semibold text-white">{t.cityName}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <p className="text-xs text-gray-400">{t.strikeDesc ?? strikeFromTicker(t.marketTicker)}</p>
                            {isLowMkt && <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/15 text-blue-400 font-medium">LOW</span>}
                          </div>
                          <p className="text-[10px] text-gray-600 font-mono mt-0.5">{t.marketTicker}</p>
                        </td>
                        {/* Side */}
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={t.side === 'yes' ? 'border-green-500/40 text-green-400' : 'border-red-500/40 text-red-400'}>
                            {t.side?.toUpperCase()}
                          </Badge>
                        </td>
                        {/* Position */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-white">{t.contracts} contracts</p>
                          <p className="text-xs text-gray-400">@ {t.priceCents != null ? `${t.priceCents}¢` : '—'} each</p>
                        </td>
                        {/* Forecast */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-white">
                            {projectedTemp?.temp != null ? `${projectedTemp.temp}°F` : "—"}
                          </p>
                          <p className="text-xs text-gray-500">{projectedTemp?.label ?? "—"}</p>
                        </td>
                        {/* Edge */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-white">{ourProbPct != null ? `${ourProbPct}%` : "—"}</p>
                          <p className={`text-xs ${edge != null && edge > 0 ? "text-green-400" : "text-red-400"}`}>
                            {edge != null ? `${edge > 0 ? "+" : ""}${edge.toFixed(0)}% vs mkt` : impliedPct != null ? `mkt ${impliedPct}%` : "—"}
                          </p>
                        </td>
                        {/* At Risk */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-semibold text-white">${stake.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">EV: {t.evCents != null ? `${Number(t.evCents).toFixed(1)}¢` : "—"}</p>
                        </td>
                        {/* P&L */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {t.won === true ? (
                            <>
                              <p className="font-semibold text-green-400">+${pnl.toFixed(2)}</p>
                              <p className="text-[10px] text-gray-500">${totalReturn.toFixed(2)} returned</p>
                            </>
                          ) : t.won === false ? (
                            <>
                              <p className="font-semibold text-red-400">-${stake.toFixed(2)}</p>
                              <p className="text-[10px] text-gray-500">$0.00 returned</p>
                            </>
                          ) : potentialWin != null ? (
                            <>
                              <p className="text-sm font-semibold text-emerald-400">+${potentialWin.toFixed(2)} if win</p>
                              <p className="text-[10px] text-gray-400">${potentialPayout!.toFixed(2)} payout</p>
                            </>
                          ) : <p className="text-sm text-gray-500">—</p>}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            {t.won === true ? (
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 w-fit">Won</Badge>
                            ) : t.won === false ? (
                              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 w-fit">Lost</Badge>
                            ) : (
                              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 w-fit">Open</Badge>
                            )}
                            {t.isPaper && <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 w-fit">Paper</Badge>}
                          </div>
                        </td>
                        {/* Resolves countdown */}
                        {(() => {
                          const cd = getCountdown(t.marketTicker, t.won ?? null);
                          return (
                            <td className="px-4 py-3 whitespace-nowrap">
                              {t.won !== null ? (
                                <span className="text-xs text-gray-600">—</span>
                              ) : (
                                <div className={`flex items-center gap-1 ${cd.urgent ? "text-orange-400" : "text-gray-300"}`}>
                                  <Clock className="h-3 w-3 shrink-0" />
                                  <span className="text-xs font-mono font-semibold">{cd.label}</span>
                                </div>
                              )}
                            </td>
                          );
                        })()}
                        {/* Date */}
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(t.createdAt).toLocaleDateString()}</td>
                      </tr>
                      {/* Expanded detail row */}
                      {isExpanded && (
                        <tr key={`${t.id}-detail`} className="border-b border-[#27272a] bg-[#111113]">
                          <td />
                          <td colSpan={10} className="px-4 py-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                              <div className="space-y-1">
                                <p className="text-gray-500 uppercase tracking-wide font-medium">Market</p>
                                <p className="text-gray-300 font-mono">{t.marketTicker ?? "—"}</p>
                                {t.marketTicker && (
                                  <a href={t.won == null ? kalshiMarketUrl(t.marketTicker, t.cityName) : KALSHI_ACTIVITY_URL}
                                    target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 mt-1">
                                    <ExternalLink className="h-3 w-3" /> View on Kalshi
                                  </a>
                                )}
                              </div>
                              <div className="space-y-1">
                                <p className="text-gray-500 uppercase tracking-wide font-medium">Conviction</p>
                                <p className="text-gray-300">{ourProbPct != null ? `${ourProbPct}% our prob` : "—"}</p>
                                <p className="text-gray-500">{impliedPct != null ? `${impliedPct}% market implied` : "—"}</p>
                                {edge != null && <p className={edge > 0 ? "text-green-400" : "text-red-400"}>{edge > 0 ? "+" : ""}{edge.toFixed(0)}% edge</p>}
                              </div>
                              <div className="space-y-1">
                                <p className="text-gray-500 uppercase tracking-wide font-medium">Economics</p>
                                <p className="text-gray-300">${stake.toFixed(2)} staked</p>
                                {potentialWin != null && <p className="text-emerald-400">+${potentialWin.toFixed(2)} if win</p>}
                                {potentialPayout != null && <p className="text-gray-500">${potentialPayout.toFixed(2)} total payout</p>}
                                <p className="text-gray-500">EV: {t.evCents != null ? `+${Number(t.evCents).toFixed(1)}¢/contract` : "—"}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="text-gray-500 uppercase tracking-wide font-medium">Settlement</p>
                                <p className="text-gray-300">{settlementDate ?? "—"}</p>
                                <p className="text-gray-500">{isLowMkt ? "Overnight low" : "Daily high"} market</p>
                                <p className="text-gray-500">Entered {new Date(t.createdAt).toLocaleString()}</p>
                                {t.settledAt && <p className="text-gray-500">Settled {new Date(t.settledAt).toLocaleString()}</p>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {page + 1} of {totalPages} · {filtered.length} trades</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="border-[#27272a] text-gray-300" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
            <Button variant="outline" size="sm" className="border-[#27272a] text-gray-300" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
