import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from "recharts";
import { TrendingUp, DollarSign, Percent, Activity, BarChart2 } from "lucide-react";

type Mode  = "paper" | "live" | "all";
type Range = 7 | 14 | 30 | 90;

// ── Shared dark tooltip ───────────────────────────────────────────────────────
function DarkTooltip({ active, payload, label, fmtValue }: {
  active?: boolean;
  payload?: any[];
  label?: string;
  fmtValue?: (v: number, name: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1c1c1f] border border-[#3f3f46] rounded-lg p-3 text-xs shadow-xl space-y-1">
      {label && <p className="text-gray-400 font-medium mb-1.5">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-medium" style={{ color: p.color }}>
            {fmtValue ? fmtValue(p.value, p.name) : p.value}
          </span>
        </p>
      ))}
    </div>
  );
}

const fmtDollar = (v: number) => `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
const fmtPct    = (v: number) => `${(v * 100).toFixed(1)}%`;

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, color, sub, icon }: {
  label: string; value: string; color: string; sub: string; icon: React.ReactNode;
}) {
  return (
    <Card className="bg-[#18181b] border-[#27272a]">
      <CardContent className="pt-4 pb-4 px-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            <p className="text-xs text-gray-600 mt-1">{sub}</p>
          </div>
          <div className="text-gray-600 mt-0.5">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ height = 220 }: { height?: number }) {
  return (
    <div className="flex items-center justify-center text-gray-700 text-sm" style={{ height }}>
      No data yet
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Charts() {
  const [mode,  setMode]  = useState<Mode>("all");
  const [range, setRange] = useState<Range>(30);

  const { data: stats }      = trpc.bot.getTradeStats.useQuery({ mode },             { refetchInterval: 30_000 });
  const { data: daily }      = trpc.bot.getDailyPnl.useQuery({ days: range, mode },  { refetchInterval: 30_000 });
  const { data: cityStats }  = trpc.bot.getCityStats.useQuery(undefined,             { refetchInterval: 30_000 });
  const { data: buckets }    = trpc.bot.getPriceBucketStats.useQuery(undefined,      { refetchInterval: 30_000 });

  // Daily P&L + running cumulative
  const dailyData = useMemo(() => {
    if (!daily?.length) return [];
    let cum = 0;
    return daily.map((d) => {
      cum += d.pnl;
      return {
        date:       new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        daily:      Math.round(d.pnl  * 100) / 100,
        cumulative: Math.round(cum    * 100) / 100,
        trades:     d.trades,
        wins:       d.wins,
      };
    });
  }, [daily]);

  // City charts — sorted slices
  const cityByPnl = useMemo(() =>
    [...(cityStats ?? [])].filter(c => c.total > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 12),
    [cityStats]
  );
  const cityByWinRate = useMemo(() =>
    [...(cityStats ?? [])].filter(c => c.total >= 2).sort((a, b) => b.winRate - a.winRate).slice(0, 12),
    [cityStats]
  );
  const cityByVolume = useMemo(() =>
    [...(cityStats ?? [])]
      .filter(c => c.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)
      .map(c => ({ ...c, losses: c.total - c.wins })),
    [cityStats]
  );

  const totalPnl = Number(stats?.totalPnl ?? 0);
  const winRate  = stats?.winRate ?? 0;
  const roi      = stats?.roi ?? 0;

  return (
    <div className="p-6 space-y-5 max-w-[92%] mx-auto">

      {/* ── Header + Filters ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-blue-400" />
            Charts
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Performance analytics across all trades and markets</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center gap-0.5 bg-[#18181b] border border-[#27272a] rounded-lg p-1">
            {(["paper", "live", "all"] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${
                  mode === m ? "bg-blue-500/20 text-blue-400" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {/* Range toggle */}
          <div className="flex items-center gap-0.5 bg-[#18181b] border border-[#27272a] rounded-lg p-1">
            {([7, 14, 30, 90] as Range[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  range === r ? "bg-blue-500/20 text-blue-400" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total P&L"
          value={`${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toFixed(2)}`}
          color={totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}
          sub={mode === "all" ? "All trades" : mode === "paper" ? "Paper only" : "Live only"}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          label="Win Rate"
          value={fmtPct(winRate)}
          color={winRate >= 0.60 ? "text-emerald-400" : winRate >= 0.50 ? "text-yellow-400" : "text-red-400"}
          sub={`${stats?.wins ?? 0}W · ${stats?.losses ?? 0}L of ${stats?.total ?? 0}`}
          icon={<Percent className="h-4 w-4" />}
        />
        <StatCard
          label="Total Trades"
          value={String(stats?.total ?? 0)}
          color="text-blue-400"
          sub={`$${Number(stats?.totalWagered ?? 0).toFixed(2)} wagered`}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="ROI"
          value={`${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`}
          color={roi >= 0 ? "text-emerald-400" : "text-red-400"}
          sub={`Avg win $${Number(stats?.avgWin ?? 0).toFixed(2)} · avg loss $${Number(stats?.avgLoss ?? 0).toFixed(2)}`}
          icon={<TrendingUp className="h-4 w-4" />}
        />
      </div>

      {/* ── P&L Over Time (main chart) ── */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-0 pt-4 px-5">
          <CardTitle className="text-sm font-medium text-white flex items-center justify-between">
            P&L Over Time
            <span className="text-xs font-normal text-gray-500">
              bars = daily · line = cumulative
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 px-2 pb-3">
          {!dailyData.length ? (
            <EmptyChart height={300} />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={dailyData} margin={{ top: 4, right: 28, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  axisLine={false} tickLine={false}
                />
                <YAxis
                  yAxisId="daily"
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => `$${v}`}
                />
                <YAxis
                  yAxisId="cum"
                  orientation="right"
                  tick={{ fill: "#71717a", fontSize: 11 }}
                  axisLine={false} tickLine={false}
                  tickFormatter={v => `$${v}`}
                />
                <Tooltip
                  content={({ active, payload, label }) => (
                    <DarkTooltip
                      active={active} payload={payload} label={label}
                      fmtValue={fmtDollar}
                    />
                  )}
                />
                <ReferenceLine yAxisId="daily" y={0} stroke="#3f3f46" strokeWidth={1} />
                <Bar
                  yAxisId="daily"
                  dataKey="daily"
                  name="Daily P&L"
                  radius={[2, 2, 0, 0]}
                  maxBarSize={32}
                >
                  {dailyData.map((d, i) => (
                    <Cell key={i} fill={d.daily >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.85} />
                  ))}
                </Bar>
                <Line
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumulative"
                  name="Cumulative P&L"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#06b6d4" }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Row 2: P&L by City + Win Rate by City ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-0 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-white">P&L by City</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-2 pb-3">
            {!cityByPnl.length ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cityByPnl} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="cityCode" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={({ active, payload, label }) => (
                    <DarkTooltip active={active} payload={payload} label={label} fmtValue={fmtDollar} />
                  )} />
                  <ReferenceLine x={0} stroke="#3f3f46" />
                  <Bar dataKey="pnl" name="P&L" radius={[0, 2, 2, 0]} maxBarSize={18}>
                    {cityByPnl.map((c, i) => (
                      <Cell key={i} fill={c.pnl >= 0 ? "#10b981" : "#ef4444"} fillOpacity={0.85} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-0 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-white">
              Win Rate by City
              <span className="text-xs font-normal text-gray-500 ml-2">min 2 trades</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-2 pb-3">
            {!cityByWinRate.length ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={cityByWinRate} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" domain={[0, 1]} tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                  <YAxis type="category" dataKey="cityCode" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={({ active, payload, label }) => (
                    <DarkTooltip active={active} payload={payload} label={label} fmtValue={fmtPct} />
                  )} />
                  <ReferenceLine x={0.5} stroke="#3f3f46" strokeDasharray="4 4" />
                  <Bar dataKey="winRate" name="Win Rate" radius={[0, 2, 2, 0]} maxBarSize={18}>
                    {cityByWinRate.map((c, i) => (
                      <Cell key={i}
                        fill={c.winRate >= 0.60 ? "#10b981" : c.winRate >= 0.50 ? "#f59e0b" : "#ef4444"}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3: Price Buckets + Trade Volume by City ── */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-0 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-white">Performance by Entry Price</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-2 pb-3">
            {!buckets?.length ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={buckets} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="pnl" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis yAxisId="wr" orientation="right" domain={[0, 1]} tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v * 100).toFixed(0)}%`} />
                  <Tooltip content={({ active, payload, label }) => (
                    <DarkTooltip active={active} payload={payload} label={label}
                      fmtValue={(v, n) => n === "Win Rate" ? fmtPct(v) : fmtDollar(v)}
                    />
                  )} />
                  <Bar yAxisId="pnl" dataKey="pnl" name="P&L" fill="#3b82f6" fillOpacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={52} />
                  <Bar yAxisId="wr"  dataKey="winRate" name="Win Rate" fill="#8b5cf6" fillOpacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={52} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-0 pt-4 px-5">
            <CardTitle className="text-sm font-medium text-white">Trade Volume by City</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 px-2 pb-3">
            {!cityByVolume.length ? <EmptyChart /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={cityByVolume} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="cityCode" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
                  <Tooltip content={({ active, payload, label }) => (
                    <DarkTooltip active={active} payload={payload} label={label} />
                  )} />
                  <Bar dataKey="wins"   name="Wins"   stackId="v" fill="#10b981" fillOpacity={0.85} maxBarSize={18} />
                  <Bar dataKey="losses" name="Losses" stackId="v" fill="#ef4444" fillOpacity={0.75} radius={[0, 2, 2, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
