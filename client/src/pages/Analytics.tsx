import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Activity, TrendingUp, Database, FlaskConical, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function Analytics() {
  const { data: stats } = trpc.bot.getTradeStats.useQuery({ mode: "paper" }, { refetchInterval: 30000 });
  const { data: cityStats } = trpc.bot.getCityStats.useQuery(undefined, { refetchInterval: 60000 });
  const { data: dailyPnl } = trpc.bot.getDailyPnl.useQuery({ mode: "paper" }, { refetchInterval: 60000 });
  const { data: priceBuckets } = trpc.bot.getPriceBucketStats.useQuery(undefined, { refetchInterval: 60000 });
  const { data: openTrades } = trpc.bot.getOpenTrades.useQuery({ mode: "paper" }, { refetchInterval: 15000 });

  const { data: probCalibration } = trpc.historical.getProbCalibration.useQuery(undefined, { refetchInterval: 60000 });
  const { data: forecastAccuracyStats } = trpc.historical.getForecastAccuracyStats.useQuery(undefined, { refetchInterval: 60000 });

  const backfillAccuracy = trpc.historical.runBackfillAccuracy.useMutation({
    onSuccess: (data) => toast.success(data.message),
    onError: (err) => toast.error(`Backfill failed: ${err.message}`),
  });
  const backfillKalshi = trpc.historical.runBackfillKalshi.useMutation({
    onSuccess: (data) => toast.success(data.message),
    onError: (err) => toast.error(`Kalshi backfill failed: ${err.message}`),
  });

  const winRate = stats ? (stats.winRate * 100).toFixed(1) : "--";
  const totalPnl = stats?.totalPnl ?? 0;
  const avgWin = stats?.avgWin ?? 0;
  const avgLoss = stats?.avgLoss ?? 0;
  const profitFactor = avgLoss !== 0 ? (avgWin / Math.abs(avgLoss)).toFixed(2) : "inf";

  const allTimePotentialReturn = stats?.totalPotentialReturn ?? 0;
  const allTimeWagered = stats?.totalWagered ?? 0;
  const allTimePotentialProfit = allTimePotentialReturn - allTimeWagered;

  const openCount = (openTrades ?? []).length;
  const openStake = (openTrades ?? []).reduce((sum: number, t: any) => sum + parseFloat(t.costBasis ?? 0), 0);
  const openPotentialProfit = (openTrades ?? []).reduce((sum: number, t: any) => {
    return sum + (Number(t.contracts) * (100 - Number(t.priceCents)) * 0.93) / 100;
  }, 0);
  const openPotentialPayout = openStake + openPotentialProfit;

  return (
    <div className="p-6 space-y-6 max-w-[70%] mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Analytics</h1>
        <p className="text-sm text-gray-400">Performance metrics and trading statistics</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500 mb-1">Win Rate</p>
            <p className="text-2xl font-bold text-blue-400">{winRate}%</p>
            <p className="text-xs text-gray-500">{stats?.wins ?? 0}W / {stats?.losses ?? 0}L</p>
          </CardContent>
        </Card>
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4 space-y-1.5">
            <p className="text-xs text-gray-500">Total P&L</p>
            <p className={`text-2xl font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
            </p>
            <p className="text-xs text-gray-600">
              ROI {stats?.roi != null ? `${(stats.roi * 100).toFixed(1)}%` : "—"}
            </p>
            <div className="pt-1 border-t border-white/5 space-y-0.5">
              <p className="text-[10px] text-green-500">
                +${(stats?.totalWinPnl ?? 0).toFixed(2)} from {stats?.wins ?? 0}W
              </p>
              <p className="text-[10px] text-red-500">
                -${Math.abs(stats?.totalLossPnl ?? 0).toFixed(2)} from {stats?.losses ?? 0}L
              </p>
            </div>
          </CardContent>
        </Card>
        {/* Open Positions — live view, updates as trades settle */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">Open Positions</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 font-medium">LIVE</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <div>
                <p className="text-[10px] text-gray-600">At Risk</p>
                <p className="text-lg font-bold text-yellow-400">{openStake > 0 ? `$${openStake.toFixed(2)}` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-600">Profit if All Win</p>
                <p className="text-lg font-bold text-emerald-400">{openPotentialProfit > 0 ? `+$${openPotentialProfit.toFixed(2)}` : "—"}</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <p className="text-[10px] text-gray-600">Total payout if all win</p>
              <p className="text-xs font-semibold text-white">{openPotentialPayout > 0 ? `$${openPotentialPayout.toFixed(2)}` : "—"}</p>
            </div>
            <p className="text-[10px] text-gray-600">{openCount} trade{openCount !== 1 ? "s" : ""} open</p>
          </CardContent>
        </Card>

        {/* All-Time Potential — cumulative across all paper trades ever placed */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500">All-Time Potential</p>
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div className="grid grid-cols-2 gap-x-3">
              <div>
                <p className="text-[10px] text-gray-600">Total Wagered</p>
                <p className="text-lg font-bold text-yellow-400">{allTimeWagered > 0 ? `$${allTimeWagered.toFixed(2)}` : "—"}</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-600">Total Payout</p>
                <p className="text-lg font-bold text-emerald-400">{allTimePotentialReturn > 0 ? `$${allTimePotentialReturn.toFixed(2)}` : "—"}</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <p className="text-[10px] text-gray-600">Net profit potential</p>
              <p className="text-xs font-semibold text-emerald-400">{allTimePotentialProfit > 0 ? `+$${allTimePotentialProfit.toFixed(2)}` : "—"}</p>
            </div>
            <p className="text-[10px] text-gray-600">if every trade had won · {(stats?.total ?? 0) + openCount} total</p>
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

      {/* Price Bracket Breakdown */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-purple-400" /> P&L by Entry Price Bracket
          </CardTitle>
        </CardHeader>
        <CardContent>
          {priceBuckets && priceBuckets.some((b: any) => b.trades > 0) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#27272a]">
                    {["Price Range", "Trades", "Wins", "Losses", "Win Rate", "P&L"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {priceBuckets.map((b: any) => {
                    const pnl = b.pnl ?? 0;
                    const wr = b.winRate ?? 0;
                    return (
                      <tr key={b.label} className="border-b border-[#27272a] hover:bg-[#27272a]/50">
                        <td className="px-3 py-2.5 text-white font-medium">{b.label}</td>
                        <td className="px-3 py-2.5 text-gray-400">{b.trades}</td>
                        <td className="px-3 py-2.5 text-green-400">{b.wins}</td>
                        <td className="px-3 py-2.5 text-red-400">{b.losses}</td>
                        <td className="px-3 py-2.5">
                          <span className={`font-medium ${wr >= 60 ? "text-green-400" : wr >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                            {wr}%
                          </span>
                        </td>
                        <td className={`px-3 py-2.5 font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">No settled trades yet.</div>
          )}
        </CardContent>
      </Card>

      {/* Performance by City */}
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
                    {["City", "Trades", "Wins", "Losses", "Win Rate", "P&L", "Avg Win", "Avg Loss"].map((h) => (
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
                      const losses = (c.total ?? 0) - (c.wins ?? 0);
                      return (
                        <tr key={c.cityCode} className="border-b border-[#27272a] hover:bg-[#27272a]/50">
                          <td className="px-3 py-2.5 text-white font-medium">{c.cityName}</td>
                          <td className="px-3 py-2.5 text-gray-400">{c.total}</td>
                          <td className="px-3 py-2.5 text-green-400">{c.wins ?? 0}</td>
                          <td className="px-3 py-2.5 text-red-400">{losses}</td>
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

      {/* ── Historical Data Section Header ─────────────────────────────────── */}
      <Card className="bg-[#0f172a] border-[#1e3a5f]">
        <CardContent className="p-4 flex items-center gap-3">
          <Database className="h-5 w-5 text-blue-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-300">Historical Data Analysis</p>
            <p className="text-xs text-gray-500">Forecast calibration and settled market history derived from past data.</p>
          </div>
        </CardContent>
      </Card>

      {/* ── Section A: Probability Calibration ─────────────────────────────── */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-yellow-400" /> Probability Calibration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-500 mb-4">
            Ideally actual win rate should match model probability. A gap means the model is overconfident.
          </p>
          {probCalibration && probCalibration.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#27272a]">
                    {["Prob Range", "Trades", "Wins", "Actual Win Rate", "Model Said"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {probCalibration.map((b: any) => {
                    const lowerPct = Math.round(b.lowerBound * 100);
                    const actualGood = b.winRate >= lowerPct;
                    return (
                      <tr key={b.label} className="border-b border-[#27272a] hover:bg-[#27272a]/50">
                        <td className="px-3 py-2.5 text-white font-medium">{b.label}</td>
                        <td className="px-3 py-2.5 text-gray-400">{b.trades}</td>
                        <td className="px-3 py-2.5 text-green-400">{b.wins}</td>
                        <td className="px-3 py-2.5">
                          <span className={`font-semibold ${actualGood ? "text-green-400" : "text-red-400"}`}>
                            {b.winRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-400">{b.avgOurProb}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">No settled trades with probability data yet.</div>
          )}
        </CardContent>
      </Card>

      {/* ── Section B: Forecast Accuracy by City ───────────────────────────── */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Database className="h-4 w-4 text-blue-400" /> Forecast Accuracy by City
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-[#27272a] text-gray-300 hover:bg-[#27272a]"
                disabled={backfillAccuracy.isPending}
                onClick={() => backfillAccuracy.mutate({ daysBack: 90 })}
              >
                {backfillAccuracy.isPending ? "Backfilling…" : "Backfill 90 Days"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-[#27272a] text-gray-300 hover:bg-[#27272a]"
                disabled={backfillKalshi.isPending}
                onClick={() => backfillKalshi.mutate()}
              >
                {backfillKalshi.isPending ? "Fetching…" : "Backfill Kalshi"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {forecastAccuracyStats && forecastAccuracyStats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#27272a]">
                    {["City", "Samples", "Avg NWS Error", "NWS Std Dev", "Avg Ensemble Error", "Ensemble Std Dev", "Bias Direction"].map((h) => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {forecastAccuracyStats.map((c: any) => {
                    const avg = c.avgErrorNws ?? 0;
                    let biasLabel: string;
                    let biasColor: string;
                    if (avg > 0.5) {
                      biasLabel = "NWS runs cold";
                      biasColor = "text-blue-400";
                    } else if (avg < -0.5) {
                      biasLabel = "NWS runs warm";
                      biasColor = "text-red-400";
                    } else {
                      biasLabel = "Calibrated";
                      biasColor = "text-green-400";
                    }
                    return (
                      <tr key={c.cityCode} className="border-b border-[#27272a] hover:bg-[#27272a]/50">
                        <td className="px-3 py-2.5 text-white font-medium">{c.cityName}</td>
                        <td className="px-3 py-2.5 text-gray-400">{c.samples}</td>
                        <td className="px-3 py-2.5 text-gray-300">
                          {c.avgErrorNws != null ? `${c.avgErrorNws > 0 ? "+" : ""}${c.avgErrorNws}°F` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-gray-400">
                          {c.stdErrorNws != null ? `±${c.stdErrorNws}°F` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-gray-300">
                          {c.avgErrorEnsemble != null ? `${c.avgErrorEnsemble > 0 ? "+" : ""}${c.avgErrorEnsemble}°F` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-gray-400">
                          {c.stdErrorEnsemble != null ? `±${c.stdErrorEnsemble}°F` : "—"}
                        </td>
                        <td className={`px-3 py-2.5 font-medium ${biasColor}`}>{biasLabel}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">
              No forecast accuracy data yet. Click "Backfill 90 Days" to populate.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
