import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Search, Filter, Download, RefreshCw } from "lucide-react";

const PAGE_SIZE = 20;

export default function Trades() {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: trades, isLoading, refetch } = trpc.bot.getTrades.useQuery(
    { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    { refetchInterval: 15000 }
  );
  const { data: stats } = trpc.bot.getTradeStats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: openTrades } = trpc.bot.getOpenTrades.useQuery(undefined, { refetchInterval: 10000 });

  const filtered = (trades ?? []).filter((t: any) => {
    const matchSearch = !search || t.cityName?.toLowerCase().includes(search.toLowerCase()) || t.marketTicker?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || (statusFilter === "open" && t.won == null) || (statusFilter === "won" && t.won === true) || (statusFilter === "lost" && t.won === false);
    return matchSearch && matchStatus;
  });

  const totalPnl = stats?.totalPnl ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Trade History</h1>
          <p className="text-sm text-gray-400">All Kalshi weather market trades</p>
        </div>
        <Button variant="outline" size="sm" className="border-[#27272a] text-gray-300 hover:text-white" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Trades", value: (trades ?? []).length > 0 ? (trades ?? []).length : (stats?.total ?? 0), color: "text-white" },
          { label: "Win Rate", value: `${((stats?.winRate ?? 0) * 100).toFixed(1)}%`, color: "text-blue-400" },
          { label: "Total P&L", value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? "text-green-400" : "text-red-400" },
          { label: "Open Positions", value: openTrades?.length ?? 0, color: "text-yellow-400" },
        ].map(({ label, value, color }) => (
          <Card key={label} className="bg-[#18181b] border-[#27272a]">
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Open Positions */}
      {openTrades && openTrades.length > 0 && (
        <Card className="bg-[#18181b] border-[#27272a] border-yellow-500/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-yellow-400 flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" /> Open Positions ({openTrades.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {openTrades.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-[#27272a]">
                  <div>
                    <p className="text-sm font-medium text-white">{t.cityName}</p>
                    <p className="text-xs text-gray-400">{t.strikeDesc} · {t.side?.toUpperCase()} · {t.contracts} contracts @ {t.priceCents}¢</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-white font-medium">${parseFloat(t.costBasis ?? 0).toFixed(2)}</p>
                    <p className="text-xs text-gray-500">{new Date(t.createdAt).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
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
                        <td className="px-4 py-3 text-gray-400 font-mono text-xs">{t.marketTicker}</td>
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
                          {t.won === true ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Won</Badge>
                          ) : t.won === false ? (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Lost</Badge>
                          ) : (
                            <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Open</Badge>
                          )}
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