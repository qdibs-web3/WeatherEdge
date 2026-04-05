import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Bot, Play, Square, Zap, RefreshCw, Target, Shield, MapPin, CheckCircle2, XCircle, AlertTriangle, ClipboardCheck, FlaskConical } from "lucide-react";

const ALL_CITIES = [
  { code: "NYC", name: "New York City" },   { code: "LAX", name: "Los Angeles" },
  { code: "CHI", name: "Chicago" },         { code: "HOU", name: "Houston" },
  { code: "PHX", name: "Phoenix" },         { code: "PHI", name: "Philadelphia" },
  { code: "DAL", name: "Dallas" },          { code: "ATL", name: "Atlanta" },
  { code: "SFO", name: "San Francisco" },   { code: "SEA", name: "Seattle" },
  { code: "DEN", name: "Denver" },          { code: "BOS", name: "Boston" },
  { code: "LAS", name: "Las Vegas" },       { code: "OKC", name: "Oklahoma City" },
  { code: "MSP", name: "Minneapolis" },     { code: "DCA", name: "Washington DC" },
  { code: "MIA", name: "Miami" },           { code: "AUS", name: "Austin" },
  { code: "MSY", name: "New Orleans" },     { code: "SAT", name: "San Antonio" },
];

export default function BotControl() {
  const { data: status, refetch: refetchStatus } = trpc.bot.getStatus.useQuery(undefined, { refetchInterval: 3000 });
  const { data: config } = trpc.config.getBotConfig.useQuery();
  const { data: openPaperTrades } = trpc.bot.getOpenTrades.useQuery({ mode: "paper" }, { refetchInterval: 10000 });
  const { data: backtest } = trpc.bot.getBacktestSummary.useQuery(undefined, { staleTime: 60_000 });
  const { data: paramSim } = trpc.bot.getParamSimulation.useQuery(undefined, { staleTime: 60_000 });
  const utils = trpc.useContext();

  const [flatBet, setFlatBet] = useState<number>(20);
  const [maxDailyTrades, setMaxDailyTrades] = useState<number>(20);
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [selectedCities, setSelectedCities] = useState<string[]>(ALL_CITIES.map(c => c.code));

  // Load config into state whenever it arrives or changes from the server
  useEffect(() => {
    if (!config) return;
    setFlatBet(config.flatBetDollars ?? 20);
    setMaxDailyTrades(config.maxDailyTrades ?? 20);
    setDryRun(config.dryRun ?? true);
    setSelectedCities(
      config.enabledCities && config.enabledCities.length > 0
        ? config.enabledCities
        : ALL_CITIES.map(c => c.code)
    );
  }, [config]);

  const startMutation = trpc.bot.start.useMutation({
    onSuccess: () => { toast.success("Bot started successfully!"); refetchStatus(); },
    onError: (e) => toast.error(`Failed to start: ${e.message}`),
  });
  const stopMutation = trpc.bot.stop.useMutation({
    onSuccess: () => { toast.success("Bot stopped."); refetchStatus(); },
    onError: (e) => toast.error(`Failed to stop: ${e.message}`),
  });
  const restartMutation = trpc.bot.restart.useMutation({
    onSuccess: () => { toast.success("Bot restarted!"); refetchStatus(); },
    onError: (e) => toast.error(`Failed to restart: ${e.message}`),
  });
  const scanMutation = trpc.bot.triggerScan.useMutation({
    onSuccess: (d) => toast.success(`Scan complete — ${d.signals.length} signal(s) found`),
    onError: (e) => toast.error(e.message),
  });
  const saveConfigMutation = trpc.config.saveBotConfig.useMutation({
    onSuccess: () => { toast.success("Configuration saved!"); utils.config.getBotConfig.invalidate(); utils.bot.getStatus.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const paperToggleMutation = trpc.config.saveBotConfig.useMutation({
    onSuccess: () => { utils.config.getBotConfig.invalidate(); utils.bot.getStatus.invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const settlePaperMutation = trpc.bot.settlePaperTrades.useMutation({
    onSuccess: (d) => {
      toast.success(`Paper settlement complete — ${d.settled} trade(s) settled`);
      utils.bot.getOpenTrades.invalidate();
      utils.bot.getTrades.invalidate();
      utils.bot.getTradeStats.invalidate();
    },
    onError: (e) => toast.error(`Settlement failed: ${e.message}`),
  });
  const clearPaperMutation = trpc.bot.clearPaperTrades.useMutation({
    onSuccess: () => {
      toast.success("All paper trades cleared. Starting fresh!");
      utils.bot.getOpenTrades.invalidate();
      utils.bot.getTrades.invalidate();
      utils.bot.getTradeStats.invalidate();
      utils.bot.getBacktestSummary.invalidate();
    },
    onError: (e) => toast.error(`Clear failed: ${e.message}`),
  });

  const toggleCity = (code: string) => {
    setSelectedCities(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const handleSave = () => {
    saveConfigMutation.mutate({ flatBetDollars: flatBet, maxDailyTrades, dryRun, enabledCities: selectedCities });
  };

  const handleReset = () => {
    if (!config) return;
    setFlatBet(config.flatBetDollars ?? 20);
    setMaxDailyTrades(config.maxDailyTrades ?? 20);
    setDryRun(config.dryRun ?? true);
    setSelectedCities(
      config.enabledCities && config.enabledCities.length > 0
        ? config.enabledCities
        : ALL_CITIES.map(c => c.code)
    );
  };

  const isRunning = status?.running ?? false;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Bot Control</h1>
        <p className="text-sm text-gray-400">Manage, configure, and monitor your weather trading bot</p>
      </div>

      {/* Status + Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-400" /> Bot Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[#27272a]">
              <div className={`w-3 h-3 rounded-full ${isRunning ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">{isRunning ? 'Bot is Running' : 'Bot is Stopped'}</p>
                <p className="text-xs text-gray-400">
                  {isRunning ? `Last scan: ${status?.lastScanAt ? new Date(status.lastScanAt).toLocaleTimeString() : 'never'}` : 'Click Start to begin trading'}
                </p>
              </div>
              <Badge className={isRunning ? "bg-green-500/20 text-green-400 border-green-500/30" : "bg-gray-500/20 text-gray-400 border-gray-500/30"}>
                {isRunning ? 'Active' : 'Idle'}
              </Badge>
            </div>

            {status?.dryRun && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
                <p className="text-xs text-yellow-300">Paper trading mode — no real money at risk</p>
              </div>
            )}

            {status?.errorMessage && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <XCircle className="h-4 w-4 text-red-400 shrink-0" />
                <p className="text-xs text-red-300">{status.errorMessage}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#27272a] rounded p-2.5">
                <p className="text-gray-500">Trades Today</p>
                <p className="text-white font-semibold text-base">{(status as any)?.dailyTradeCount ?? 0}</p>
              </div>
              <div className="bg-[#27272a] rounded p-2.5">
                <p className="text-gray-500">Active Cities</p>
                <p className="text-white font-semibold text-base">{selectedCities.length}</p>
              </div>
            </div>

            <div className="flex gap-2">
              {!isRunning ? (
                <Button className="flex-1 bg-green-600 hover:bg-green-500" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                  <Play className="h-4 w-4 mr-1.5" /> {startMutation.isPending ? 'Starting...' : 'Start Bot'}
                </Button>
              ) : (
                <Button className="flex-1" variant="destructive" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending}>
                  <Square className="h-4 w-4 mr-1.5" /> {stopMutation.isPending ? 'Stopping...' : 'Stop Bot'}
                </Button>
              )}
              <Button className="bg-gray-600 hover:bg-gray-500 text-white" onClick={() => restartMutation.mutate()} disabled={restartMutation.isPending || !isRunning}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            <Button className="w-full bg-blue-600 hover:bg-blue-500 text-white" onClick={() => scanMutation.mutate()} disabled={!isRunning || scanMutation.isPending}>
              <Zap className="h-4 w-4 mr-1.5" /> {scanMutation.isPending ? 'Scanning...' : 'Trigger Manual Scan'}
            </Button>

            {status?.dryRun && (openPaperTrades?.length ?? 0) > 0 && (
              <Button
                className="w-full bg-amber-600 hover:bg-amber-500 text-white"
                onClick={() => settlePaperMutation.mutate()}
                disabled={settlePaperMutation.isPending}
              >
                <ClipboardCheck className="h-4 w-4 mr-1.5" />
                {settlePaperMutation.isPending
                  ? 'Settling...'
                  : `Settle Paper Trades (${openPaperTrades?.length ?? 0} open)`}
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full border-red-800 text-red-400 hover:bg-red-900/30 hover:text-red-300"
              onClick={() => {
                if (confirm("Delete ALL paper trades and start fresh? This cannot be undone.")) {
                  clearPaperMutation.mutate();
                }
              }}
              disabled={clearPaperMutation.isPending}
            >
              {clearPaperMutation.isPending ? "Clearing..." : "Clear All Paper Trades"}
            </Button>
          </CardContent>
        </Card>

        {/* Trade Parameters */}
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-400" /> Trade Parameters
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-gray-300 text-sm">Flat Bet Size</Label>
                <span className="text-blue-400 text-sm font-semibold">${flatBet}</span>
              </div>
              <Slider min={5} max={200} step={5} value={[flatBet]} onValueChange={([v]) => setFlatBet(v)} className="w-full" />
              <p className="text-xs text-gray-500">Base stake — multiplied 0.5×–3.0× by model conviction (formula: (prob−0.50)/0.15)</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-gray-300 text-sm">Max Daily Trades</Label>
                <span className="text-blue-400 text-sm font-semibold">{maxDailyTrades}</span>
              </div>
              <Slider min={1} max={50} step={1} value={[maxDailyTrades]} onValueChange={([v]) => setMaxDailyTrades(v)} className="w-full" />
              <p className="text-xs text-gray-500">Max positions per day — applies to both paper and live mode</p>
            </div>

            {/* Locked strategy constants */}
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-purple-300 uppercase tracking-wide">Locked Strategy Constants</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">Min Conviction</p>
                  <p className="text-white font-semibold">58% win prob</p>
                </div>
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">Min Model Edge</p>
                  <p className="text-white font-semibold">8% std / 7% @≥72%</p>
                </div>
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">Bet Scale Range</p>
                  <p className="text-white font-semibold">0.5× – 3.0×</p>
                </div>
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">Min Win Profit</p>
                  <p className="text-white font-semibold">15% of flat bet</p>
                </div>
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">NO Safety Bonus</p>
                  <p className="text-white font-semibold">+0.5× at σ ≥ 1.5</p>
                </div>
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">Max Entry Price</p>
                  <p className="text-white font-semibold">55¢</p>
                </div>
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">YES Safety Floor</p>
                  <p className="text-white font-semibold">+0.5σ above strike</p>
                </div>
                <div className="bg-[#27272a] rounded p-2">
                  <p className="text-gray-500">NO Safety Floor</p>
                  <p className="text-white font-semibold">−1.2σ below strike</p>
                </div>
              </div>
              <p className="text-xs text-gray-500">High-conviction trades (≥72% prob) use 7% min edge and scale up to 3.0×. NO safety bonus adds +0.5× when the blended forecast is ≥1.5σ below the strike. Min win profit of 15% prevents chasing thin-margin fills. All Kalshi fees (7%) factored in.</p>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-[#27272a]">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-yellow-400" />
                <div>
                  <Label className="text-gray-300 text-sm cursor-pointer">Paper Trading Mode</Label>
                  <p className="text-xs text-gray-500">Simulate trades without real money</p>
                </div>
              </div>
              <Switch
                checked={dryRun}
                onCheckedChange={(val) => {
                  setDryRun(val);
                  paperToggleMutation.mutate({ dryRun: val });
                  if (isRunning) {
                    restartMutation.mutate();
                    toast.info(`Switched to ${val ? "Paper" : "Live"} mode — bot restarting...`);
                  } else {
                    toast.info(`Switched to ${val ? "Paper" : "Live"} mode`);
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* City Selection */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-cyan-400" /> Active Cities ({selectedCities.length}/{ALL_CITIES.length})
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-white h-7" onClick={() => setSelectedCities(ALL_CITIES.map(c => c.code))}>All</Button>
              <Button variant="ghost" size="sm" className="text-xs text-gray-400 hover:text-white h-7" onClick={() => setSelectedCities([])}>None</Button>
            </div>
          </div>
          <CardDescription>Select which cities to monitor for trading opportunities</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {ALL_CITIES.map((city) => {
              const active = selectedCities.includes(city.code);
              return (
                <button
                  key={city.code}
                  onClick={() => toggleCity(city.code)}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-sm transition-all ${
                    active
                      ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                      : 'bg-[#27272a] border-[#3f3f46] text-gray-500 hover:border-gray-500'
                  }`}
                >
                  {active ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-400" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-gray-600" />}
                  <span className="truncate">{city.name}</span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Kalshi Series Discovery */}
      <KalshiSeriesDiscovery />

      {/* Backtest Performance Analysis */}
      {backtest && (
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Target className="h-4 w-4 text-amber-400" /> Paper Trade Performance Analysis
            </CardTitle>
            <CardDescription>
              Breakdown of your {backtest.totalTrades} settled paper trades — win rate: <span className={backtest.overallWinRate >= 50 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>{backtest.overallWinRate}%</span> | P&L: <span className={backtest.totalPnl >= 0 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>${backtest.totalPnl.toFixed(2)}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* By Price Bucket */}
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Win Rate by Entry Price</p>
                <div className="space-y-1.5">
                  {backtest.byPrice.map((b) => (
                    <div key={b.label} className="flex items-center justify-between text-xs bg-[#27272a] rounded px-2.5 py-1.5">
                      <span className="text-gray-300">{b.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">{b.trades} trades</span>
                        <span className={b.winRate >= 50 ? "text-green-400 font-semibold w-12 text-right" : "text-red-400 font-semibold w-12 text-right"}>{b.winRate}%</span>
                        <span className={b.pnl >= 0 ? "text-green-400 w-16 text-right" : "text-red-400 w-16 text-right"}>${b.pnl.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* By Probability */}
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Win Rate by Model Conviction</p>
                <div className="space-y-1.5">
                  {backtest.byProb.map((b) => (
                    <div key={b.label} className="flex items-center justify-between text-xs bg-[#27272a] rounded px-2.5 py-1.5">
                      <span className="text-gray-300">{b.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">{b.trades} trades</span>
                        <span className={b.winRate >= 50 ? "text-green-400 font-semibold w-12 text-right" : "text-red-400 font-semibold w-12 text-right"}>{b.winRate}%</span>
                        <span className={b.pnl >= 0 ? "text-green-400 w-16 text-right" : "text-red-400 w-16 text-right"}>${b.pnl.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* By Side */}
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Win Rate by Side</p>
                <div className="space-y-1.5">
                  {backtest.bySide.map((b) => (
                    <div key={b.label} className="flex items-center justify-between text-xs bg-[#27272a] rounded px-2.5 py-1.5">
                      <span className="text-gray-300 uppercase">{b.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">{b.trades} trades</span>
                        <span className={b.winRate >= 50 ? "text-green-400 font-semibold w-12 text-right" : "text-red-400 font-semibold w-12 text-right"}>{b.winRate}%</span>
                        <span className={b.pnl >= 0 ? "text-green-400 w-16 text-right" : "text-red-400 w-16 text-right"}>${b.pnl.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* By Strike Type */}
              <div>
                <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">Win Rate by Strike Type</p>
                <div className="space-y-1.5">
                  {backtest.byStrike.map((b) => (
                    <div key={b.label} className="flex items-center justify-between text-xs bg-[#27272a] rounded px-2.5 py-1.5">
                      <span className="text-gray-300 capitalize">{b.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">{b.trades} trades</span>
                        <span className={b.winRate >= 50 ? "text-green-400 font-semibold w-12 text-right" : "text-red-400 font-semibold w-12 text-right"}>{b.winRate}%</span>
                        <span className={b.pnl >= 0 ? "text-green-400 w-16 text-right" : "text-red-400 w-16 text-right"}>${b.pnl.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {/* V2 simulation — what if we'd only taken high-conviction trades? */}
            {backtest.v2Simulation && backtest.v2Simulation.trades > 0 && (
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
                <p className="text-xs font-semibold text-blue-300 uppercase tracking-wide">V2 Strategy Simulation (high-conviction subset)</p>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="bg-[#27272a] rounded p-2 text-center">
                    <p className="text-gray-500">Trades</p>
                    <p className="text-white font-semibold">{backtest.v2Simulation.trades}</p>
                  </div>
                  <div className="bg-[#27272a] rounded p-2 text-center">
                    <p className="text-gray-500">Wins</p>
                    <p className="text-white font-semibold">{backtest.v2Simulation.wins}</p>
                  </div>
                  <div className="bg-[#27272a] rounded p-2 text-center">
                    <p className="text-gray-500">Win Rate</p>
                    <p className={backtest.v2Simulation.winRate >= 60 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>{backtest.v2Simulation.winRate}%</p>
                  </div>
                  <div className="bg-[#27272a] rounded p-2 text-center">
                    <p className="text-gray-500">P&L</p>
                    <p className={backtest.v2Simulation.pnl >= 0 ? "text-green-400 font-semibold" : "text-red-400 font-semibold"}>${backtest.v2Simulation.pnl.toFixed(2)}</p>
                  </div>
                </div>
                <p className="text-xs text-gray-500">{backtest.v2Simulation.note} — {backtest.v2Simulation.skipped} low-conviction trades excluded</p>
              </div>
            )}
            {backtest.overallWinRate < 40 && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300">
                  Win rate below 40% — consider tightening filters. Current strategy uses 58% conviction floor,
                  tiered 8%/7% model edge, and 0.5×–3.0× conviction scaling targeting higher-quality entries.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Param Simulator */}
      {paramSim && paramSim.length > 0 && paramSim.some((s: any) => s.trades > 0) && (
        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-violet-400" /> Param Simulator — Retroactive Test
            </CardTitle>
            <CardDescription>
              How each parameter combo would have performed against your {(paramSim[0]?.trades ?? 0) + (paramSim[0]?.skipped ?? 0)} settled trades.
              Use this to pick the next config before changing anything live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[#27272a]">
                    {["Scenario", "Trades", "Wins", "Losses", "Win Rate", "P&L", "Skipped"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-500 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paramSim.map((s: any, i: number) => (
                    <tr key={s.label} className={`border-b border-[#27272a] ${i === 0 ? "opacity-50" : "hover:bg-[#27272a]/50"}`}>
                      <td className="px-3 py-2.5 text-white font-medium">
                        {s.label}
                        {i === 0 && <span className="ml-2 text-[10px] text-gray-500">(current)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400">{s.trades}</td>
                      <td className="px-3 py-2.5 text-green-400">{s.wins}</td>
                      <td className="px-3 py-2.5 text-red-400">{s.losses}</td>
                      <td className="px-3 py-2.5">
                        <span className={`font-semibold ${s.winRate >= 60 ? "text-green-400" : s.winRate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                          {s.winRate}%
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 font-semibold ${s.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}
                      </td>
                      <td className="px-3 py-2.5 text-gray-500">{s.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-600 mt-3">
              "Skipped" = trades that would not have been placed under that scenario's filters. Lower skipped = more trades found.
              Aim for the scenario with positive P&L and a skipped count that still leaves enough trades per day.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Save Button */}
      <div className="flex justify-end gap-3">
        <Button variant="outline" className="border-[#27272a] text-gray-300" onClick={handleReset}>Reset</Button>
        <Button className="bg-blue-600 hover:bg-blue-500 px-8" onClick={handleSave} disabled={saveConfigMutation.isPending}>
          {saveConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
        </Button>
      </div>
    </div>
  );
}

// ─── Kalshi Series Discovery ────────────────────────────────────────────────
// Queries the live Kalshi API for all KXHIGH* and KXLOW* weather series so you can
// find the correct seriesTicker to use when adding new cities.
function KalshiSeriesDiscovery() {
  const [show, setShow] = useState(false);
  const { data, isFetching, error, refetch } = trpc.bot.discoverWeatherSeries.useQuery(undefined, {
    enabled: false,
  });

  return (
    <Card className="bg-[#18181b] border-[#27272a]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-400" /> Kalshi Series Discovery
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-gray-400 hover:text-white h-7"
            onClick={() => { setShow(true); refetch(); }}
            disabled={isFetching}
          >
            {isFetching ? <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            {isFetching ? "Fetching..." : "Fetch from Kalshi"}
          </Button>
        </div>
        <CardDescription>
          Find correct series tickers for new cities before adding them to the bot config.
        </CardDescription>
      </CardHeader>
      {show && (
        <CardContent>
          {error && (
            <p className="text-red-400 text-xs">Error: {(error as any).message}</p>
          )}
          {data && data.length === 0 && (
            <p className="text-gray-500 text-xs">No weather series found. Check your Kalshi API credentials.</p>
          )}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              {(["high", "low"] as const).map((type) => {
                const rows = data.filter((s: any) => s.type === type);
                if (rows.length === 0) return null;
                return (
                  <div key={type} className="mb-4">
                    <p className="text-xs font-semibold text-gray-400 mb-1 uppercase tracking-wide">
                      {type === "high" ? "High Temp (KXHIGH*)" : "Low Temp (KXLOW*)"}
                      <span className="ml-2 text-gray-600 normal-case font-normal">{rows.length} series</span>
                    </p>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#27272a] text-gray-500">
                          <th className="text-left px-2 py-2 font-medium">Series Ticker</th>
                          <th className="text-left px-2 py-2 font-medium">Title</th>
                          <th className="text-left px-2 py-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((s: any) => (
                          <tr key={s.ticker} className="border-b border-[#27272a]/50 hover:bg-[#27272a]/30">
                            <td className="px-2 py-1.5 font-mono text-cyan-400">{s.ticker}</td>
                            <td className="px-2 py-1.5 text-gray-300">{s.title}</td>
                            <td className="px-2 py-1.5 text-gray-500">{s.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
              <p className="text-xs text-gray-600 mt-3">
                Copy the ticker from the row matching your city and paste it into nwsService.ts as the seriesTicker or lowSeriesTicker.
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}