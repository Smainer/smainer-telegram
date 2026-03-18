import React, { ReactNode } from 'react';

interface TelegramProviderProps {
  children: ReactNode;
}

// Simple wrapper that just passes children through without SDK dependency
export function TelegramProvider({ children }: TelegramProviderProps) {
  // No need for SDKProvider anymore - we use window.Telegram?.WebApp directly
  return <>{children}</>;
}