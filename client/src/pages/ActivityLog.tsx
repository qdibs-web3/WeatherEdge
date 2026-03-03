import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollText, RefreshCw, Info, AlertTriangle, CheckCircle2, XCircle, Zap } from "lucide-react";

const LEVEL_CONFIG: Record<string, { icon: any; color: string; badge: string }> = {
  info:    { icon: Info,          color: "text-blue-400",   badge: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  success: { icon: CheckCircle2,  color: "text-green-400",  badge: "bg-green-500/20 text-green-400 border-green-500/30" },
  warning: { icon: AlertTriangle, color: "text-yellow-400", badge: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  error:   { icon: XCircle,       color: "text-red-400",    badge: "bg-red-500/20 text-red-400 border-red-500/30" },
  trade:   { icon: Zap,           color: "text-purple-400", badge: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

export default function ActivityLog() {
  const [levelFilter, setLevelFilter] = useState("all");
  const { data: logs, isLoading, refetch, isFetching } = trpc.bot.getActivityLog.useQuery(
    { limit: 100 },
    { refetchInterval: 10_000 }
  );

  const filtered = (logs ?? []).filter((l: any) => levelFilter === "all" || l.level === levelFilter);

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Activity Log</h1>
          <p className="text-sm text-gray-400">Real-time bot events, trade signals, and system messages</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={levelFilter} onValueChange={setLevelFilter}>
            <SelectTrigger className="w-32 bg-[#18181b] border-[#27272a] text-gray-300 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#18181b] border-[#27272a]">
              <SelectItem value="all">All Events</SelectItem>
              <SelectItem value="trade">Trades</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warning">Warnings</SelectItem>
              <SelectItem value="error">Errors</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="border-[#27272a] text-gray-300 hover:text-white h-8"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-blue-400" />
            {filtered.length} events
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-500 text-sm">Loading activity log...</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center space-y-2">
              <ScrollText className="h-8 w-8 text-gray-600" />
              <p className="text-gray-500 text-sm">No activity yet. Start the bot to see events.</p>
            </div>
          ) : (
            <div className="divide-y divide-[#27272a]">
              {filtered.map((log: any) => {
                const cfg = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.info;
                const Icon = cfg.icon;
                return (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-[#27272a]/30 transition-colors">
                    <Icon className={`h-4 w-4 ${cfg.color} shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`${cfg.badge} text-xs px-1.5 py-0`}>{log.level}</Badge>
                        {log.cityName && (
                          <span className="text-xs text-gray-500">{log.cityName}</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-300 mt-0.5">{log.message}</p>
                      {log.details && (
                        <p className="text-xs text-gray-600 mt-0.5 font-mono truncate">{log.details}</p>
                      )}
                    </div>
                    <span className="text-xs text-gray-600 shrink-0 whitespace-nowrap" title={new Date(log.createdAt).toLocaleString()}>
                      {new Date(log.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
