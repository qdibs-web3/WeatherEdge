import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Key, User, Shield, CheckCircle2, XCircle, Eye, EyeOff, Wallet, ExternalLink } from "lucide-react";

export default function Settings() {
  const { user } = useAuth();
  const [showApiKey, setShowApiKey] = useState(false);
  const [kalshiApiKey, setKalshiApiKey] = useState("");
  const [kalshiApiKeyId, setKalshiApiKeyId] = useState("");
  const [hasExistingKey, setHasExistingKey] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileName, setProfileName] = useState(user?.name ?? "");

  const { data: config } = trpc.config.getBotConfig.useQuery();
  const { data: balance } = trpc.config.getKalshiBalance.useQuery(undefined, { refetchInterval: 60_000 });

  // Sync config into state when it arrives (replaces deprecated onSuccess callback)
  useEffect(() => {
    if (!config) return;
    if (config.kalshiApiKeyId) setKalshiApiKeyId(config.kalshiApiKeyId);
    // kalshiApiKey is returned as "masked" when a key is saved — show a placeholder instead
    if (config.kalshiApiKey === "masked") {
      setHasExistingKey(true);
    }
  }, [config]);

  const saveApiKeyMutation = trpc.config.saveKalshiApiKey.useMutation({
    onSuccess: () => {
      toast.success("Kalshi API key saved!");
      setHasExistingKey(true);
    },
    onError: (e) => toast.error(e.message),
  });

  const updatePasswordMutation = trpc.auth.updatePassword.useMutation({
    onSuccess: () => { toast.success("Password updated!"); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); },
    onError: (e) => toast.error(e.message),
  });

  const updateProfileMutation = trpc.config.updateProfile.useMutation({
    onSuccess: () => toast.success("Profile updated!"),
    onError: (e) => toast.error(e.message),
  });

  const handleSaveApiKey = () => {
    if (!kalshiApiKey.trim() && !hasExistingKey) {
      toast.error("Please enter your RSA private key");
      return;
    }
    // If user hasn't typed a new key, don't overwrite the existing one
    if (!kalshiApiKey.trim() && hasExistingKey) {
      toast.info("No changes — your existing key is still saved.");
      return;
    }
    saveApiKeyMutation.mutate({ apiKey: kalshiApiKey, apiKeyId: kalshiApiKeyId });
  };

  const handleUpdatePassword = () => {
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    if (newPassword.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    updatePasswordMutation.mutate({ currentPassword, newPassword });
  };

  const balanceAmt = (balance as any)?.balance ?? null;

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400">Manage your account and Kalshi API configuration</p>
      </div>

      {/* Kalshi API Configuration */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Key className="h-4 w-4 text-blue-400" /> Kalshi API Configuration
          </CardTitle>
          <CardDescription>
            Your API key is used to place trades on Kalshi.{" "}
            <a href="https://kalshi.com/account/api" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline inline-flex items-center gap-1">
              Get your API key <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Balance Display */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#27272a]">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-green-400" />
              <span className="text-sm text-gray-300">Kalshi Balance</span>
            </div>
            <div className="flex items-center gap-2">
              {balanceAmt !== null ? (
                <>
                  <span className="text-sm font-semibold text-white">${(balanceAmt / 100 ).toFixed(2)}</span>
                  <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                  </Badge>
                </>
              ) : (
                <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30 text-xs">
                  <XCircle className="h-3 w-3 mr-1" /> Not Connected
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-300 text-sm">API Key ID</Label>
            <Input
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={kalshiApiKeyId}
              onChange={(e) => setKalshiApiKeyId(e.target.value)}
              className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-600 font-mono text-sm"
            />
            <p className="text-xs text-gray-500">The UUID key ID from your Kalshi account</p>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-300 text-sm flex items-center gap-2">
              Private Key (RSA PEM)
              {hasExistingKey && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Key saved
                </Badge>
              )}
            </Label>
            <div className="relative">
              <textarea
                rows={showApiKey ? 6 : 2}
                placeholder={hasExistingKey ? "••• Key already saved — paste a new one to replace it •••" : "-----BEGIN RSA PRIVATE KEY-----\n..."}
                value={kalshiApiKey}
                onChange={(e) => setKalshiApiKey(e.target.value)}
                className="w-full bg-[#27272a] border border-[#3f3f46] rounded-md px-3 py-2 text-white placeholder:text-gray-500 font-mono text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ filter: showApiKey ? "none" : "blur(3px)" }}
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-300"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-gray-500">Your RSA private key for signing Kalshi API requests. Never exposed after saving.</p>
          </div>

          <Button
            className="bg-blue-600 hover:bg-blue-500"
            onClick={handleSaveApiKey}
            disabled={saveApiKeyMutation.isPending}
          >
            {saveApiKeyMutation.isPending ? "Saving..." : "Save API Key"}
          </Button>
        </CardContent>
      </Card>

      {/* Profile */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <User className="h-4 w-4 text-purple-400" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-gray-300 text-sm">Email</Label>
            <Input
              value={user?.email ?? ""}
              disabled
              className="bg-[#27272a] border-[#3f3f46] text-gray-400"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300 text-sm">Display Name</Label>
            <Input
              placeholder="Your name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="border-[#3f3f46] text-gray-400">
              Role: {user?.role ?? "user"}
            </Badge>
          </div>
          <Button
            variant="outline"
            className="border-[#27272a] text-gray-300 hover:text-white"
            onClick={() => updateProfileMutation.mutate({ name: profileName })}
            disabled={updateProfileMutation.isPending}
          >
            {updateProfileMutation.isPending ? "Saving..." : "Update Profile"}
          </Button>
        </CardContent>
      </Card>

      {/* Security */}
      <Card className="bg-[#18181b] border-[#27272a]">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Shield className="h-4 w-4 text-green-400" /> Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-gray-300 text-sm">Current Password</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-600"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300 text-sm">New Password</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-600"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300 text-sm">Confirm New Password</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="bg-[#27272a] border-[#3f3f46] text-white placeholder:text-gray-600"
            />
          </div>
          <Button
            variant="outline"
            className="border-[#27272a] text-gray-300 hover:text-white"
            onClick={handleUpdatePassword}
            disabled={updatePasswordMutation.isPending}
          >
            {updatePasswordMutation.isPending ? "Updating..." : "Update Password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
