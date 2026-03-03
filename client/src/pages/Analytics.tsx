import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Activity } from "lucide-react";

export default function Analytics() {
  const { data: stats } = trpc.bot.getTradeStats.useQuery(undefined, { refetchInterval: 30000 });
  const { data: cityStats } = trpc.bot.getCityStats.useQuery(undefined, { refetchInterval: 60000 });
  const { data: dailyPnl } = trpc.bot.getDailyPnl.useQuery(undefined, { refetchInterval: 60000 });

  const winRate = stats ? (stats.winRate * 100).toFixed(1) : "--";
  const totalPnl = stats?.totalPnl ?? 0;
  const avgWin = stats?.avgWin ?? 0;
  const avgLoss = stats?.avgLoss ?? 0;
  const profitFactor = avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : "inf";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Analytics</h1>
        <p className="text-sm text-gray-400">Performance metrics and trading statistics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 mb-1">Win Rate</p>
            <p className="text-2xl font-bold text-blue-400">{winRate}%</p>
            <p className="text-xs text-gray-500">{stats?.wins ?? 0}W / {stats?.losses ?? 0}L</p>
          </CardContent>
        </Card>
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 mb-1">Total P&L</p>
            <p className={`text-2xl font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </p>
            <p className="text-xs text-gray-500">{stats?.total ?? 0} trades</p>
          </CardContent>
        </Card>
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 mb-1">Avg Win</p>
            <p className="text-2xl font-bold text-green-400">+${avgWin.toFixed(2)}</p>
            <p className="text-xs text-gray-500">per winning trade</p>
          </CardContent>
        </Card>
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 mb-1">Profit Factor</p>
            <p className="text-2xl font-bold text-purple-400">{profitFactor}</p>
            <p className="text-xs text-gray-500">win/loss ratio</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-blue-400" /> Daily P&L (Last 14 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dailyPnl && dailyPnl.length > 0 ? (
            <div className="space-y-2">
              {dailyPnl.slice(-14).map((d: any) => {
                const pnl = parseFloat(d.pnl ?? 0);
                const maxAbs = Math.max(...dailyPnl.map((x: any) => Math.abs(parseFloat(x.pnl ?? 0))), 1);
                const width = (Math.abs(pnl) / maxAbs) * 100;
                return (
                  <div key={d.date} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20 shrink-0">
                      {new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <div className="flex-1 bg-[#27272a] rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pnl >= 0 ? "bg-green-500" : "bg-red-500"}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className={`text-xs font-medium w-16 text-right ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                    </span>
                    <span className="text-xs text-gray-600 w-10 text-right">{d.trades}t</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">No P&L data yet. Trades will appear here after they settle.</div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-400" /> Performance by City
          </CardTitle>
        </CardHeader>
        <CardContent>
          {cityStats && cityStats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#27272a]">
                    {["City", "Trades", "Win Rate", "P&L", "Avg Win", "Avg Loss"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...cityStats]
                    .sort((a: any, b: any) => parseFloat(b.pnl) - parseFloat(a.pnl))
                    .map((c: any) => {
                      const pnl = parseFloat(c.pnl ?? 0);
                      const wr = (parseFloat(c.winRate ?? 0) * 100).toFixed(0);
                      return (
                        <tr key={c.cityCode} className="border-b border-[#27272a] hover:bg-[#27272a]/50">
                          <td className="px-3 py-2.5 text-white font-medium">{c.cityName}</td>
                          <td className="px-3 py-2.5 text-gray-400">{c.total}</td>
                          <td className="px-3 py-2.5">
                            <span className={`font-medium ${parseFloat(wr) >= 60 ? "text-green-400" : parseFloat(wr) >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                              {wr}%
                            </span>
                          </td>
                          <td className={`px-3 py-2.5 font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-green-400">+${parseFloat(c.avgWin ?? 0).toFixed(2)}</td>
                          <td className="px-3 py-2.5 text-red-400">-${Math.abs(parseFloat(c.avgLoss ?? 0)).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">No city data yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
