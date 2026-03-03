import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { CloudSun, TrendingUp, Zap } from "lucide-react";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regName, setRegName] = useState("");

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => { login(data.token, data.user as any); setLocation("/dashboard"); },
    onError: (e) => toast.error(e.message),
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: (data) => { login(data.token, data.user as any); setLocation("/dashboard"); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo */}
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 flex items-center justify-center">
              <CloudSun className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">WeatherEdge</h1>
          </div>
          <p className="text-gray-400 text-sm">Kalshi Weather Trading Bot — powered by NWS forecasts</p>
        </div>

        {/* Feature pills */}
        <div className="flex gap-2 justify-center flex-wrap">
          {["19 US Cities", "NWS Forecast Edge", "Auto-Trading"].map((f) => (
            <span key={f} className="text-xs px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">{f}</span>
          ))}
        </div>

        <Card className="bg-[#18181b] border-[#27272a]">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-lg">Welcome back</CardTitle>
            <CardDescription>Sign in to your trading dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="login">
              <TabsList className="w-full bg-[#27272a] mb-4">
                <TabsTrigger value="login" className="flex-1">Sign In</TabsTrigger>
                <TabsTrigger value="register" className="flex-1">Create Account</TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-300">Email</Label>
                  <Input id="email" type="email" placeholder="you@example.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)}
                    className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-gray-300">Password</Label>
                  <Input id="password" type="password" placeholder="••••••••" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate({ email: loginEmail, password: loginPassword })}
                    className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-500" />
                </div>
                <Button className="w-full bg-blue-600 hover:bg-blue-500" onClick={() => loginMutation.mutate({ email: loginEmail, password: loginPassword })} disabled={loginMutation.isLoading}>
                  {loginMutation.isLoading ? "Signing in..." : "Sign In"}
                </Button>
              </TabsContent>

              <TabsContent value="register" className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="rname" className="text-gray-300">Name (optional)</Label>
                  <Input id="rname" placeholder="Your name" value={regName} onChange={(e) => setRegName(e.target.value)}
                    className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="remail" className="text-gray-300">Email</Label>
                  <Input id="remail" type="email" placeholder="you@example.com" value={regEmail} onChange={(e) => setRegEmail(e.target.value)}
                    className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-500" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rpassword" className="text-gray-300">Password (min 8 chars)</Label>
                  <Input id="rpassword" type="password" placeholder="••••••••" value={regPassword} onChange={(e) => setRegPassword(e.target.value)}
                    className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-500" />
                </div>
                <Button className="w-full bg-blue-600 hover:bg-blue-500" onClick={() => registerMutation.mutate({ email: regEmail, password: regPassword, name: regName || undefined })} disabled={registerMutation.isLoading}>
                  {registerMutation.isLoading ? "Creating account..." : "Create Account"}
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-3 text-center">
          {[{ icon: TrendingUp, label: "73.5%", sub: "Win Rate" }, { icon: Zap, label: "8.8/day", sub: "Avg Trades" }, { icon: CloudSun, label: "19", sub: "Cities" }].map(({ icon: Icon, label, sub }) => (
            <div key={sub} className="bg-[#18181b] border border-[#27272a] rounded-lg p-3">
              <Icon className="h-4 w-4 text-blue-400 mx-auto mb-1" />
              <div className="text-white font-semibold text-sm">{label}</div>
              <div className="text-gray-500 text-xs">{sub}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
