import React, { useState, useEffect } from 'react';

interface BootStep {
  name: string;
  status: 'pending' | 'success' | 'error';
  timestamp: number;
  error?: string;
}

interface DebugOverlayState {
  isVisible: boolean;
  bootSteps: BootStep[];
  errors: Array<{
    type: 'error' | 'unhandledrejection';
    message: string;
    timestamp: number;
    stack?: string;
  }>;
  telegram: {
    available: boolean;
    webAppVersion?: string;
    initDataUnsafe?: any;
  };
}

const initialState: DebugOverlayState = {
  isVisible: false,
  bootSteps: [],
  errors: [],
  telegram: {
    available: false,
  },
};

export function DebugOverlay() {
  const [state, setState] = useState<DebugOverlayState>(initialState);

  useEffect(() => {
    // Check if debug mode is enabled via URL param or error occurred
    const urlParams = new URLSearchParams(window.location.search);
    const debugEnabled = urlParams.get('debug') === '1';

    // Initialize error capturing
    const handleError = (event: ErrorEvent) => {
      const error = {
        type: 'error' as const,
        message: event.message,
        timestamp: Date.now(),
        stack: event.error?.stack,
      };
      
      setState(prev => ({
        ...prev,
        isVisible: true, // Show on error
        errors: [...prev.errors, error],
      }));
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const error = {
        type: 'unhandledrejection' as const,
        message: String(event.reason),
        timestamp: Date.now(),
        stack: event.reason?.stack,
      };
      
      setState(prev => ({
        ...prev,
        isVisible: true, // Show on error
        errors: [...prev.errors, error],
      }));
    };

    // Listen for boot step events
    const handleBootStep = (event: CustomEvent) => {
      const { name, status, error } = event.detail;
      setState(prev => ({
        ...prev,
        bootSteps: [...prev.bootSteps, {
          name,
          status,
          timestamp: Date.now(),
          error,
        }],
      }));
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('debugBootStep', handleBootStep as EventListener);

    // Gather Telegram WebApp info
    const tgWebApp = (window as any).Telegram?.WebApp;
    setState(prev => ({
      ...prev,
      isVisible: debugEnabled,
      telegram: {
        available: !!tgWebApp,
        webAppVersion: tgWebApp?.version,
        initDataUnsafe: tgWebApp?.initDataUnsafe,
      },
    }));

    // Record initial boot step
    addBootStep('app_mounted', 'success');

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('debugBootStep', handleBootStep as EventListener);
    };
  }, []);

  const addBootStep = (name: string, status: 'success' | 'error', error?: string) => {
    setState(prev => ({
      ...prev,
      bootSteps: [...prev.bootSteps, {
        name,
        status,
        timestamp: Date.now(),
        error,
      }],
    }));
  };

  const toggleVisibility = () => {
    setState(prev => ({ ...prev, isVisible: !prev.isVisible }));
  };

  if (!state.isVisible) {
    return (
      <button
        onClick={toggleVisibility}
        className="fixed bottom-4 left-4 z-50 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center text-xs font-bold opacity-50 hover:opacity-100"
        title="Debug Info"
      >
        🐛
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-start justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-96 overflow-hidden">
        <div className="bg-red-500 text-white p-3 flex justify-between items-center">
          <h3 className="font-bold">🐛 Debug Info</h3>
          <button
            onClick={toggleVisibility}
            className="text-white hover:bg-red-600 rounded px-2 py-1"
          >
            ✕
          </button>
        </div>
        
        <div className="p-4 max-h-80 overflow-y-auto space-y-4">
          {/* Boot Steps */}
          <div>
            <h4 className="font-semibold mb-2">Boot Steps</h4>
            <div className="space-y-1 text-sm">
              {state.bootSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    step.status === 'success' ? 'bg-green-500' : 
                    step.status === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                  }`} />
                  <span>{step.name}</span>
                  {step.error && <span className="text-red-600 text-xs">({step.error})</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Telegram Info */}
          <div>
            <h4 className="font-semibold mb-2">Telegram Environment</h4>
            <div className="text-sm space-y-1">
              <div>Available: {state.telegram.available ? '✅' : '❌'}</div>
              {state.telegram.webAppVersion && (
                <div>Version: {state.telegram.webAppVersion}</div>
              )}
              {state.telegram.initDataUnsafe && (
                <div>
                  User: {state.telegram.initDataUnsafe.user?.first_name || 'N/A'}
                </div>
              )}
            </div>
          </div>

          {/* Errors */}
          {state.errors.length > 0 && (
            <div>
              <h4 className="font-semibold mb-2 text-red-600">Errors ({state.errors.length})</h4>
              <div className="space-y-2 text-sm">
                {state.errors.map((error, i) => (
                  <div key={i} className="bg-red-50 p-2 rounded border-l-4 border-red-500">
                    <div className="font-medium text-red-700">{error.message}</div>
                    <div className="text-xs text-red-600">{error.type} at {new Date(error.timestamp).toLocaleTimeString()}</div>
                    {error.stack && (
                      <pre className="text-xs text-red-600 mt-1 overflow-x-auto">
                        {error.stack.slice(0, 200)}...
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Environment */}
          <div>
            <h4 className="font-semibold mb-2">Environment</h4>
            <div className="text-xs space-y-1">
              <div>URL: {window.location.href}</div>
              <div>User Agent: {navigator.userAgent.slice(0, 80)}...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Export utility function for other components to add boot steps
export function addDebugBootStep(name: string, status: 'success' | 'error', error?: string) {
  // Dispatch custom event that the overlay can listen to
  window.dispatchEvent(new CustomEvent('debugBootStep', {
    detail: { name, status, error }
  }));
}