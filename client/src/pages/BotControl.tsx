import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { Bot, Play, Square, Zap, RefreshCw, DollarSign, Target, Shield, MapPin, CheckCircle2, XCircle, AlertTriangle, ClipboardCheck } from "lucide-react";

const ALL_CITIES = [
  { code: "NYC", name: "New York City" },   { code: "LAX", name: "Los Angeles" },
  { code: "CHI", name: "Chicago" },         { code: "HOU", name: "Houston" },
  { code: "PHX", name: "Phoenix" },         { code: "PHI", name: "Philadelphia" },
  { code: "DAL", name: "Dallas" },
  { code: "ATL", name: "Atlanta" },         { code: "SFO", name: "San Francisco" },
  { code: "SEA", name: "Seattle" },         { code: "DEN", name: "Denver" },
  { code: "BOS", name: "Boston" },          { code: "LAS", name: "Las Vegas" },
  { code: "OKC", name: "Oklahoma City" },   { code: "MSP", name: "Minneapolis" },
  { code: "DCA", name: "Washington DC" },   { code: "MIA", name: "Miami" },
  { code: "AUS", name: "Austin" },          { code: "MSY", name: "New Orleans" },
];

export default function BotControl() {
  const { data: status, refetch: refetchStatus } = trpc.bot.getStatus.useQuery(undefined, { refetchInterval: 3000 });
  const { data: config } = trpc.config.getBotConfig.useQuery();
  const { data: openPaperTrades } = trpc.bot.getOpenTrades.useQuery({ mode: "paper" }, { refetchInterval: 10000 });
  const utils = trpc.useContext();

  const [flatBet, setFlatBet] = useState<number>(20);
  const [minEv, setMinEv] = useState<number>(3);
  const [maxPrice, setMaxPrice] = useState<number>(70);
  const [maxDailyTrades, setMaxDailyTrades] = useState<number>(20);
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [selectedCities, setSelectedCities] = useState<string[]>(ALL_CITIES.map(c => c.code));

  // Load config into state whenever it arrives or changes from the server
  useEffect(() => {
    if (!config) return;
    setFlatBet(config.flatBetDollars ?? 20);
    setMinEv(config.minEvCents ?? 3);
    setMaxPrice(config.maxPriceCents ?? 70);
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

  const toggleCity = (code: string) => {
    setSelectedCities(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const handleSave = () => {
    saveConfigMutation.mutate({ flatBetDollars: flatBet, minEvCents: minEv, maxPriceCents: maxPrice, maxDailyTrades, dryRun, enabledCities: selectedCities });
  };

  const handleReset = () => {
    if (!config) return;
    setFlatBet(config.flatBetDollars ?? 20);
    setMinEv(config.minEvCents ?? 3);
    setMaxPrice(config.maxPriceCents ?? 70);
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
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
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
                <p className="text-gray-500">Signals Today</p>
                <p className="text-white font-semibold text-base">{status?.signalsFound ?? 0}</p>
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
              <p className="text-xs text-gray-500">Amount wagered per trade (contracts × price)</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-gray-300 text-sm">Min EV Threshold</Label>
                <span className="text-blue-400 text-sm font-semibold">{minEv}¢</span>
              </div>
              <Slider min={2} max={25} step={1} value={[minEv]} onValueChange={([v]) => setMinEv(v)} className="w-full" />
              <p className="text-xs text-gray-500">Minimum EV edge per contract — higher = fewer but stronger trades</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-gray-300 text-sm">Max Entry Price</Label>
                <span className="text-blue-400 text-sm font-semibold">{maxPrice}¢</span>
              </div>
              <Slider min={10} max={45} step={5} value={[maxPrice]} onValueChange={([v]) => setMaxPrice(v)} className="w-full" />
              <p className="text-xs text-gray-500">Hard-capped at 45¢ — above that, Kalshi's 7% fee erases win profit</p>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label className="text-gray-300 text-sm">Max Daily Trades</Label>
                <span className="text-blue-400 text-sm font-semibold">{maxDailyTrades}</span>
              </div>
              <Slider min={1} max={50} step={1} value={[maxDailyTrades]} onValueChange={([v]) => setMaxDailyTrades(v)} className="w-full" />
              <p className="text-xs text-gray-500">Max positions opened per day — applies to both paper and live mode</p>
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