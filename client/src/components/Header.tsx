import { useWalletAuth } from '../hooks/useWalletAuth';

export function Header() {
  const { address, logout } = useWalletAuth();
  
  const shortenAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };
  
  return (
    <header className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <h1 className="text-xl font-bold text-gray-900">
              Polymarket Bot
            </h1>
          </div>
          
          <div className="flex items-center space-x-4">
            {address && (
              <>
                <div className="flex items-center space-x-2 bg-gray-100 px-4 py-2 rounded-lg">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-sm font-mono text-gray-700">
                    {shortenAddress(address)}
                  </span>
                </div>
                
                <button
                  onClick={logout}
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}