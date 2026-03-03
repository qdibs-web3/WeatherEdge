import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Activity, AlertCircle, CheckCircle, XCircle } from "lucide-react";

export default function BotMonitoring() {
  const { data: botStats, isLoading } = trpc.admin.getBotStats.useQuery();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bot Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Bots</CardTitle>
            <Activity className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{botStats?.activeBots || 0}</div>
            <p className="text-xs text-muted-foreground">Currently running</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
            <CheckCircle className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{botStats?.totalTrades || 0}</div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Errors</CardTitle>
            <AlertCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{botStats?.errors?.length || 0}</div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>
      </div>

      {/* Active Bot Instances */}
      <Card>
        <CardHeader>
          <CardTitle>Active Bot Instances</CardTitle>
          <CardDescription>Currently running trading bots</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {botStats?.botInstances?.length === 0 ? (
              <p className="text-center text-muted-foreground py-4">No active bots</p>
            ) : (
              botStats?.botInstances?.map((bot: any) => (
                <div
                  key={bot.userId}
                  className="flex items-center justify-between border rounded-lg p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-green-600 animate-pulse" />
                    <div>
                      <p className="font-medium">{bot.userName}</p>
                      <p className="text-sm text-muted-foreground">User ID: {bot.userId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium">{bot.trades} trades</p>
                      <p className="text-xs text-muted-foreground">
                        ${bot.volume} volume
                      </p>
                    </div>
                    <Badge variant={bot.status === "running" ? "default" : "secondary"}>
                      {bot.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Errors */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Errors</CardTitle>
          <CardDescription>Bot errors and issues</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {!botStats?.errors || botStats?.errors?.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <CheckCircle className="mr-2 h-5 w-5" />
                <span>No errors - all systems operational</span>
              </div>
            ) : (
              botStats?.errors?.map((error: any, index: number) => (
                <div
                  key={index}
                  className="flex items-start gap-3 border rounded-lg p-3 bg-destructive/5"
                >
                  <XCircle className="h-5 w-5 text-destructive mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium">{error.message}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      User: {error.userName} • {new Date(error.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Metrics</CardTitle>
          <CardDescription>Overall bot performance statistics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Win Rate</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-600"
                    style={{ width: `${botStats?.winRate || 0}%` }}
                  />
                </div>
                <span className="text-sm font-medium">{botStats?.winRate || 0}%</span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Total Profit</p>
              <p className="text-2xl font-bold text-green-600">
                ${botStats?.totalProfit || 0}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Total Volume</p>
              <p className="text-2xl font-bold">${botStats?.totalVolume || 0}</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Active Bots</p>
              <p className="text-2xl font-bold">{botStats?.activeBots || 0}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}