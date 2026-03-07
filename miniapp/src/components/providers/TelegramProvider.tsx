'use client';

import React from 'react';
import { SDKProvider } from '@telegram-apps/sdk-react';

interface TelegramProviderProps {
  children: React.ReactNode;
}

export function TelegramProvider({ children }: TelegramProviderProps) {
  return (
    <SDKProvider acceptCustomStyles debug>
      {children}
    </SDKProvider>
  );
}