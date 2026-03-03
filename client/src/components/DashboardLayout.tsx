import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { Redirect } from "wouter";
import { AppSidebar } from "./AppSidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return (
    <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!isAuthenticated) return <Redirect to="/login" />;

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex">
      <AppSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
