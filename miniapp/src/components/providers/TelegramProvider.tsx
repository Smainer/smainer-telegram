import React, { Component, ReactNode } from 'react';
import { SDKProvider } from '@telegram-apps/sdk-react';

interface TelegramProviderProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

// Catches SDK initialization errors when outside Telegram (e.g. browser preview)
class SDKErrorBoundary extends Component<TelegramProviderProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    // If SDK failed (we're outside Telegram), render children without SDK context
    if (this.state.hasError) {
      return <>{this.props.children}</>;
    }
    return (
      <SDKProvider acceptCustomStyles>
        {this.props.children}
      </SDKProvider>
    );
  }
}

export function TelegramProvider({ children }: TelegramProviderProps) {
  return <SDKErrorBoundary>{children}</SDKErrorBoundary>;
}