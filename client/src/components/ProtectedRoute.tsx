import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAccount } from 'wagmi';
import { trpc } from '../lib/trpc';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isConnected } = useAccount();
  const [, navigate] = useLocation();
  const { data: user, isLoading } = trpc.wallet.me.useQuery(undefined, {
    retry: false,
  });
  
  useEffect(() => {
    if (!isLoading && (!isConnected || !user)) {
      navigate('/login');
    }
  }, [isConnected, user, isLoading, navigate]);
  
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  if (!isConnected || !user) {
    return null;
  }
  
  return <>{children}</>;
}