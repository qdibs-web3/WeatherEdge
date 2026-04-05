import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { trpc } from "@/lib/trpc";
import { Home, Bot, TrendingUp, BarChart3, CloudSun, BarChart2, Settings, LogOut, User, ChevronDown, Activity } from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { name: "Bot Control", href: "/bot", icon: Bot },
  { name: "Trades", href: "/trades", icon: TrendingUp },
  { name: "Analytics", href: "/analytics", icon: BarChart3 },
  { name: "Forecasts", href: "/forecasts", icon: CloudSun },
  { name: "Charts", href: "/charts", icon: BarChart2 },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { data: botStatus } = trpc.bot.getStatus.useQuery(undefined, { refetchInterval: 5000 });

  return (
    <aside className="w-60 bg-[#111113] border-r border-[#27272a] flex flex-col shrink-0">
      {/* Logo */}
      <div className="p-5 border-b border-[#27272a]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center shrink-0">
            <CloudSun className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">WeatherEdge</h1>
            <p className="text-[10px] text-gray-500 leading-tight">Kalshi Weather Bot</p>
          </div>
        </div>
      </div>

      {/* Bot Status Indicator */}
      <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        <span className="text-xs text-gray-400 flex-1">Bot Status</span>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${botStatus?.running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
          <span className={`text-xs font-medium ${botStatus?.running ? 'text-green-400' : 'text-gray-500'}`}>
            {botStatus?.running ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 mt-1">
        {navigation.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href || (item.href === "/dashboard" && location === "/");
          return (
            <button
              key={item.name}
              onClick={() => setLocation(item.href)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                isActive
                  ? "bg-blue-500/15 text-blue-400 font-medium"
                  : "text-gray-400 hover:bg-[#27272a] hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.name}</span>
            </button>
          );
        })}
      </nav>

      {/* User Menu */}
      <div className="p-3 border-t border-[#27272a]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[#27272a] transition-colors">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                <User className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm text-white font-medium truncate">{user?.name || "Trader"}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-gray-500 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-52 bg-[#18181b] border-[#27272a]" align="end" side="top">
            <DropdownMenuLabel className="text-gray-400 text-xs">Account</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[#27272a]" />
            <DropdownMenuItem onClick={() => setLocation("/settings")} className="text-gray-300 hover:text-white cursor-pointer">
              <Settings className="h-4 w-4 mr-2" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#27272a]" />
            <DropdownMenuItem onClick={logout} className="text-red-400 hover:text-red-300 cursor-pointer">
              <LogOut className="h-4 w-4 mr-2" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
