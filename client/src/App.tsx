import { Route, Switch, Redirect } from "wouter";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import DashboardLayout from "./components/DashboardLayout";
import LoginPage from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import BotControl from "./pages/BotControl";
import Trades from "./pages/Trades";
import Analytics from "./pages/Analytics";
import Forecasts from "./pages/Forecasts";
import Settings from "./pages/Settings";
import Charts from "./pages/Charts";
import NotFound from "./pages/NotFound";
import ErrorBoundary from "./components/ErrorBoundary";
import "./index.css";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center"><div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/"><ProtectedRoute><DashboardLayout><Dashboard /></DashboardLayout></ProtectedRoute></Route>
      <Route path="/dashboard"><ProtectedRoute><DashboardLayout><Dashboard /></DashboardLayout></ProtectedRoute></Route>
      <Route path="/bot"><ProtectedRoute><DashboardLayout><BotControl /></DashboardLayout></ProtectedRoute></Route>
      <Route path="/trades"><ProtectedRoute><DashboardLayout><Trades /></DashboardLayout></ProtectedRoute></Route>
      <Route path="/analytics"><ProtectedRoute><DashboardLayout><Analytics /></DashboardLayout></ProtectedRoute></Route>
      <Route path="/forecasts"><ProtectedRoute><DashboardLayout><Forecasts /></DashboardLayout></ProtectedRoute></Route>
      <Route path="/charts"><ProtectedRoute><DashboardLayout><Charts /></DashboardLayout></ProtectedRoute></Route>
      <Route path="/settings"><ProtectedRoute><DashboardLayout><Settings /></DashboardLayout></ProtectedRoute></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
