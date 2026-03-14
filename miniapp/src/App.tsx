import { useInitData, useMiniApp, useThemeParams } from '@telegram-apps/sdk-react';
import { useAccount } from '@starknet-react/core';
import { useState, useEffect } from 'react';

import { WalletConnect } from './components/WalletConnect';
import { ChatInterface } from './components/ChatInterface';
import { useRelayerAPI } from './hooks/useRelayerAPI';
import type { ConnectedWallet, InferenceRequest } from './types';

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [currentView, setCurrentView] = useState<'home' | 'chat' | 'nft' | 'dashboard'>('home');

  // These hooks throw outside Telegram — catch gracefully
  let initData: ReturnType<typeof useInitData> | undefined;
  let miniApp: ReturnType<typeof useMiniApp> | undefined;
  try { 
    initData = useInitData(); 
    miniApp = useMiniApp();
    useThemeParams();
  } catch (error) { 
    console.log('Running outside Telegram, using fallback mode');
    initData = undefined; 
    miniApp = undefined;
  }
  const { address, isConnected } = useAccount();

  // Initialize Relayer API connection
  const relayerAPI = useRelayerAPI({
    baseUrl: import.meta.env.VITE_RELAYER_URL || 'https://api.smainer.io',
    walletAddress: connectedWallet?.address,
  });

  useEffect(() => {
    // Initialize the mini app
    if (miniApp) {
      try {
        miniApp.ready();
      } catch (error) {
        console.log('Mini app initialization failed:', error);
      }
    }
    setIsLoading(false);
  }, [miniApp]);

  useEffect(() => {
    // Update connected wallet when Starknet account changes
    if (isConnected && address) {
      setConnectedWallet({
        address,
        type: 'argentx', // TODO: Detect actual wallet type
        balance_strk: '0', // TODO: Fetch actual balances
        balance_smainer: '0',
      });
    } else {
      setConnectedWallet(null);
    }
  }, [isConnected, address]);

  const handleWalletConnect = (wallet: ConnectedWallet) => {
    setConnectedWallet(wallet);
    setCurrentView('chat'); // Auto-navigate to chat after connecting
  };

  const handleWalletDisconnect = () => {
    setConnectedWallet(null);
    setCurrentView('home');
  };

  const handleSubmitInferenceTask = async (request: InferenceRequest): Promise<string> => {
    try {
      const taskId = await relayerAPI.submitInferenceTask(request);
      
      // Show task submitted notification
      console.log('AI task submitted! You will receive the result shortly.');
      
      return taskId;
    } catch (error) {
      console.error('Failed to submit inference task:', error);
      alert(`Failed to submit task: ${error}`);
      
      throw error;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-tg-bg">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-smainer-green"></div>
      </div>
    );
  }

  // If no wallet connected, show connection interface
  if (!connectedWallet) {
    return (
      <main className="min-h-screen p-4 bg-tg-bg">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-smainer-green mb-2">
              ⚡ Smainer AI
            </h1>
            <p className="text-tg-text-hint">
              High-Performance AI Inference on Starknet
            </p>
          </div>

          {/* Telegram User Info */}
          {initData?.user && (
            <div className="mb-6 p-4 bg-tg-secondary-bg border border-tg-separator rounded-lg">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-smainer-green/10 rounded-full flex items-center justify-center">
                  <span className="text-sm">
                    {initData.user.firstName?.[0] || '👤'}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-tg-text">
                    {initData.user.firstName} {initData.user.lastName}
                  </p>
                  <p className="text-sm text-tg-text-hint">
                    @{initData.user.username || `user${initData.user.id}`}
                  </p>
                </div>
              </div>
            </div>
          )}

          <WalletConnect 
            onConnect={handleWalletConnect}
            onDisconnect={handleWalletDisconnect}
          />

          {/* Connection Status */}
          <div className="mt-6 p-3 bg-muted/50 rounded-lg text-center">
            <div className="flex items-center justify-center space-x-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-tg-text-hint">
                Relayer: {relayerAPI.isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {relayerAPI.availableModels.length > 0 && (
              <p className="text-xs text-tg-text-hint mt-1">
                {relayerAPI.availableModels.length} AI models available
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  // Main app interface with navigation
  return (
    <main className="min-h-screen bg-tg-bg flex flex-col">
      {/* Navigation Bar */}
      {currentView !== 'chat' && (
        <div className="bg-tg-secondary-bg border-b border-tg-separator p-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-smainer-green">⚡ Smainer</h1>
            
            <div className="flex items-center space-x-2">
              <div className="text-xs text-tg-text-hint">
                {connectedWallet.address.slice(0, 6)}...{connectedWallet.address.slice(-4)}
              </div>
              <div className={`w-2 h-2 rounded-full ${relayerAPI.isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex space-x-1 mt-3">
            {[
              { id: 'home', label: '🏠 Home', view: 'home' },
              { id: 'chat', label: '🤖 AI Chat', view: 'chat' },
              { id: 'nft', label: '🎨 NFTs', view: 'nft' },
              { id: 'dashboard', label: '📊 Dashboard', view: 'dashboard' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setCurrentView(tab.view as any)}
                className={`flex-1 px-3 py-2 text-xs rounded transition-colors ${
                  currentView === tab.view
                    ? 'bg-smainer-green text-white'
                    : 'text-tg-text-hint hover:bg-tg-bg'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-hidden">
        {currentView === 'home' && (
          <div className="p-4">
            <div className="max-w-md mx-auto space-y-4">
              <div className="text-center mb-6">
                <h2 className="text-lg font-semibold text-tg-text mb-2">Welcome to Smainer AI</h2>
                <p className="text-sm text-tg-text-hint">
                  Choose an action to get started with AI-powered features
                </p>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={() => setCurrentView('chat')}
                  className="w-full p-4 bg-smainer-green hover:bg-smainer-green/90 text-white rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
                >
                  <span>🤖</span>
                  <span>Start AI Chat</span>
                </button>
                
                <button 
                  onClick={() => setCurrentView('nft')}
                  className="w-full p-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
                >
                  <span>🎨</span>
                  <span>Create & Mint NFTs</span>
                </button>
                
                <button 
                  onClick={() => setCurrentView('dashboard')}
                  className="w-full p-4 border border-tg-separator hover:bg-tg-secondary-bg rounded-lg font-medium transition-colors flex items-center justify-center space-x-2"
                >
                  <span>📊</span>
                  <span>View Dashboard</span>
                </button>
              </div>

              {/* Stats */}
              <div className="mt-8 grid grid-cols-2 gap-4">
                <div className="p-3 bg-tg-secondary-bg border border-tg-separator rounded-lg text-center">
                  <div className="text-lg font-bold text-smainer-green">
                    {relayerAPI.availableModels.length}
                  </div>
                  <div className="text-xs text-tg-text-hint">AI Models</div>
                </div>
                <div className="p-3 bg-tg-secondary-bg border border-tg-separator rounded-lg text-center">
                  <div className="text-lg font-bold text-smainer-green">0</div>
                  <div className="text-xs text-tg-text-hint">NFTs Minted</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentView === 'chat' && (
          <ChatInterface
            walletAddress={connectedWallet.address}
            availableModels={relayerAPI.availableModels}
            onSubmitTask={handleSubmitInferenceTask}
            onTaskUpdate={(taskId, status) => {
              console.log('Task update:', taskId, status);
              // Handle task updates
            }}
          />
        )}

        {currentView === 'nft' && (
          <div className="p-4">
            <div className="max-w-md mx-auto text-center">
              <h2 className="text-lg font-semibold text-tg-text mb-4">NFT Gallery</h2>
              <div className="p-8 border border-tg-separator rounded-lg">
                <div className="text-4xl mb-4">🎨</div>
                <h3 className="font-medium text-tg-text mb-2">Create AI-Generated NFTs</h3>
                <p className="text-sm text-tg-text-hint mb-4">
                  Generate images with AI and mint them as NFTs on Starknet
                </p>
                <button 
                  onClick={() => setCurrentView('chat')}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
                >
                  Start Creating
                </button>
              </div>
            </div>
          </div>
        )}

        {currentView === 'dashboard' && (
          <div className="p-4">
            <div className="max-w-md mx-auto">
              <h2 className="text-lg font-semibold text-tg-text mb-4">Dashboard</h2>
              
              <div className="space-y-4">
                <div className="p-4 bg-tg-secondary-bg border border-tg-separator rounded-lg">
                  <h3 className="font-medium text-tg-text mb-2">Wallet Balance</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">STRK:</span>
                      <span className="text-sm text-tg-text">{connectedWallet.balance_strk}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">SMAINER:</span>
                      <span className="text-sm text-tg-text">{connectedWallet.balance_smainer}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-tg-secondary-bg border border-tg-separator rounded-lg">
                  <h3 className="font-medium text-tg-text mb-2">Network Status</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">Relayer:</span>
                      <span className={`text-sm ${relayerAPI.isConnected ? 'text-green-600' : 'text-red-600'}`}>
                        {relayerAPI.isConnected ? 'Connected' : 'Disconnected'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-tg-text-hint">Available Models:</span>
                      <span className="text-sm text-tg-text">{relayerAPI.availableModels.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}