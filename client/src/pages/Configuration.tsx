import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Save, CheckCircle2, Settings } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function Configuration() {
  const { isConnected } = useAccount();
  const [isSaving, setIsSaving] = useState(false);

  // Fetch current config — staleTime prevents re-fetching on every mount
  const { data: config, isLoading, refetch } = trpc.config.get.useQuery(
    undefined,
    {
      enabled: isConnected,
      staleTime: 30_000,   // treat data as fresh for 30s
      retry: 1,            // only retry once on failure
    }
  );

  // Form state — initialised to defaults, updated when config loads
  const [maxPositionSize, setMaxPositionSize] = useState("100");
  const [dailySpendLimit, setDailySpendLimit] = useState("1000");
  const [edgeThreshold, setEdgeThreshold] = useState(2);

  // Populate form once config arrives from server
  useEffect(() => {
    if (!config) return;
    setMaxPositionSize(config.max_position_size ?? "100");
    setDailySpendLimit(config.daily_spend_limit ?? "1000");
    setEdgeThreshold(parseFloat(config.btc15m_edge_threshold ?? "0.02") * 100);
  }, [config]);

  // Update mutation
  const updateMutation = trpc.config.update.useMutation({
    onSuccess: () => {
      setIsSaving(false);
      toast.success("Configuration saved successfully!");
      refetch();
    },
    onError: (error) => {
      setIsSaving(false);
      toast.error(error.message || "Failed to save configuration");
    },
  });

  const handleSave = () => {
    setIsSaving(true);
    updateMutation.mutate({
      max_position_size: maxPositionSize,
      daily_spend_limit: dailySpendLimit,
      btc15m_edge_threshold: (edgeThreshold / 100).toString(),
    });
  };

  const handleReset = () => {
    setMaxPositionSize(config?.max_position_size || "100");
    setDailySpendLimit(config?.daily_spend_limit || "1000");
    setEdgeThreshold(parseFloat(config?.btc15m_edge_threshold || "0.02") * 100);
    toast.info("Reset to saved values");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-10xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Configuration</h1>
        <p className="text-gray-400 mt-1">
          Customize your bot's trading parameters and risk management settings.
        </p>
      </div>

      {/* Info Alert */}
      <Alert className="bg-blue-500/10 border-blue-500/50">
        <Settings className="h-4 w-4 text-blue-500" />
        <AlertDescription className="text-blue-400">
          Changes will take effect on the next trading cycle. Stop and restart the bot to apply immediately.
        </AlertDescription>
      </Alert>

      {/* BTC 15-Minute Strategy Settings */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader>
          <CardTitle>BTC 15-Minute Strategy</CardTitle>
          <CardDescription className="text-gray-400">
            Configure the Bitcoin 15-minute trading strategy parameters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Edge Threshold */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="edge-threshold" className="text-white">
                Edge Threshold
              </Label>
              <span className="text-sm text-gray-400">{edgeThreshold.toFixed(1)}%</span>
            </div>
            <Slider
              id="edge-threshold"
              min={0.5}
              max={10}
              step={0.1}
              value={[edgeThreshold]}
              onValueChange={(value) => setEdgeThreshold(value[0])}
              className="w-full"
            />
            <p className="text-xs text-gray-500">
              Minimum edge required to execute a trade. Higher values mean fewer but higher-confidence trades.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Risk Management */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader>
          <CardTitle>Risk Management</CardTitle>
          <CardDescription className="text-gray-400">
            Set limits to protect your capital
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Max Position Size */}
          <div className="space-y-2">
            <Label htmlFor="max-position" className="text-white">
              Maximum Position Size (USDC)
            </Label>
            <Input
              id="max-position"
              type="number"
              value={maxPositionSize}
              onChange={(e) => setMaxPositionSize(e.target.value)}
              placeholder="100"
              className="bg-[#0a0a0b] border-[#27272a] text-white"
            />
            <p className="text-xs text-gray-500">
              Maximum amount to risk on a single trade
            </p>
          </div>

          {/* Daily Spend Limit */}
          <div className="space-y-2">
            <Label htmlFor="daily-limit" className="text-white">
              Daily Spending Limit (USDC)
            </Label>
            <Input
              id="daily-limit"
              type="number"
              value={dailySpendLimit}
              onChange={(e) => setDailySpendLimit(e.target.value)}
              placeholder="1000"
              className="bg-[#0a0a0b] border-[#27272a] text-white"
            />
            <p className="text-xs text-gray-500">
              Maximum total amount to trade per day. Bot will pause when limit is reached.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Execution Interval */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader>
          <CardTitle>Execution Interval</CardTitle>
          <CardDescription className="text-gray-400">
            How often the bot checks for trading opportunities
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span className="text-white">Every 15 minutes</span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            This interval is optimized for the BTC 15-minute strategy and cannot be changed.
          </p>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="flex-1 bg-blue-600 hover:bg-blue-500 hover:shadow-[0_0_18px_4px_rgba(59,130,246,0.55)] transition-all duration-200 disabled:opacity-40"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Configuration
            </>
          )}
        </Button>
        <Button
          onClick={handleReset}
          variant="outline"
          disabled={isSaving}
          className="border-[#3f3f46] text-gray-300 hover:border-blue-500/60 hover:text-blue-300 hover:bg-blue-500/10 hover:shadow-[0_0_12px_2px_rgba(59,130,246,0.30)] transition-all duration-200"
        >
          Reset
        </Button>
      </div>
    </div>
  );
}