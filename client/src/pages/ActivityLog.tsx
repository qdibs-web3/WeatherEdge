import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ScrollText, RefreshCw, Info, AlertTriangle, CheckCircle2,
  XCircle, Zap, Radio, TrendingUp
} from "lucide-react";

// ── Level config ──────────────────────────────────────────────────────────────
const LEVEL_CONFIG: Record<string, { icon: any; color: string; badge: string; label: string }> = {
  info:    { icon: Info,          color: "text-blue-400",   badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",     label: "Info" },
  success: { icon: CheckCircle2,  color: "text-green-400",  badge: "bg-green-500/20 text-green-400 border-green-500/30",   label: "Success" },
  warning: { icon: AlertTriangle, color: "text-yellow-400", badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "Warning" },
  error:   { icon: XCircle,       color: "text-red-400",    badge: "bg-red-500/20 text-red-400 border-red-500/30",         label: "Error" },
  trade:   { icon: Zap,           color: "text-purple-400", badge: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "Trade" },
  signal:  { icon: TrendingUp,    color: "text-cyan-400",   badge: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",      label: "Signal" },
};

// Tabs
type Tab = "all" | "signal" | "trade" | "info" | "warning" | "error";
const TABS: { id: Tab; label: string; color: string }[] = [
  { id: "all",     label: "All",      color: "text-gray-300" },
  { id: "signal",  label: "Signals",  color: "text-cyan-400" },
  { id: "trade",   label: "Trades",   color: "text-purple-400" },
  { id: "info",    label: "Info",     color: "text-blue-400" },
  { id: "warning", label: "Warnings", color: "text-yellow-400" },
  { id: "error",   label: "Errors",   color: "text-red-400" },
];

export default function ActivityLog() {
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: logs, isLoading, refetch, isFetching } = trpc.bot.getActivityLog.useQuery(
    { limit: 500 },
    { refetchInterval: 5_000 }
  );

  const filtered = (logs ?? []).filter((l: any) =>
    activeTab === "all" ? true : l.level === activeTab
  );

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [filtered.length, autoScroll]);

  // Pause auto-scroll if user manually scrolls up
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  const tradeCount  = (logs ?? []).filter((l: any) => l.level === "trade").length;
  const signalCount = (logs ?? []).filter((l: any) => l.level === "signal").length;

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Radio className={`h-4 w-4 ${isFetching ? "text-emerald-400 animate-pulse" : "text-gray-600"}`} />
            Activity Log
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Signals, trades, and bot events · auto-refreshes every 5s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-xs ${autoScroll ? "text-emerald-400" : "text-gray-600"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${autoScroll ? "bg-emerald-400 animate-pulse" : "bg-gray-600"}`} />
            {autoScroll ? "Live" : "Paused"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-[#27272a] text-gray-300 hover:text-white h-8 text-xs"
            onClick={() => { refetch(); setAutoScroll(true); }}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-gray-600">
        <span><span className="text-cyan-400 font-medium">{signalCount}</span> signals</span>
        <span><span className="text-purple-400 font-medium">{tradeCount}</span> trades</span>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#27272a] pb-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? `border-current ${tab.color}`
                : "border-transparent text-gray-600 hover:text-gray-400"
            }`}
          >
            {tab.label}
            {tab.id !== "all" && (
              <span className="ml-1.5 text-[10px] opacity-60">
                {(logs ?? []).filter((l: any) => l.level === tab.id).length || ""}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Log table */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-2 pt-3 px-4">
          <CardTitle className="text-xs font-medium text-gray-500 flex items-center gap-2">
            <ScrollText className="h-3.5 w-3.5" />
            {filtered.length} entries
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <ScrollText className="h-8 w-8 text-gray-700" />
              <p className="text-gray-600 text-sm">No events yet.</p>
            </div>
          ) : (
            <div
              ref={containerRef}
              onScroll={handleScroll}
              className="divide-y divide-[#27272a] max-h-[680px] overflow-y-auto"
            >
              {filtered.map((log: any) => {
                const cfg = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.info;
                const Icon = cfg.icon;
                const isTrade  = log.level === "trade";
                const isSignal = log.level === "signal";

                return (
                  <div
                    key={log.id}
                    className={`flex items-start gap-2.5 px-4 py-2 transition-colors ${
                      isTrade  ? "bg-purple-500/5 hover:bg-purple-500/10" :
                      isSignal ? "bg-cyan-500/5 hover:bg-cyan-500/10" :
                                 "hover:bg-[#27272a]/30"
                    }`}
                  >
                    <Icon className={`h-3.5 w-3.5 ${cfg.color} shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <Badge className={`${cfg.badge} text-[10px] px-1.5 py-0 border`}>{cfg.label}</Badge>
                        {log.cityCode && (
                          <span className="text-[10px] text-gray-600 font-mono">{log.cityCode}</span>
                        )}
                      </div>
                      <p className={`text-xs ${isTrade ? "text-purple-200" : isSignal ? "text-cyan-200" : "text-gray-300"}`}>
                        {log.message}
                      </p>
                    </div>
                    <span className="text-[10px] text-gray-700 shrink-0 whitespace-nowrap tabular-nums" title={new Date(log.createdAt).toLocaleString()}>
                      {new Date(log.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
