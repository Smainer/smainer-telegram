import { useState, useEffect } from 'react';

interface TelegramInitData {
  user?: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
  };
  chat_instance?: string;
  chat_type?: string;
  auth_date?: number;
  hash?: string;
}

interface TelegramMiniApp {
  ready: () => void;
  sendData: (data: string) => void;
  close: () => void;
  expand: () => void;
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  isExpanded: boolean;
  isClosingConfirmationEnabled: boolean;
  headerColor: string;
  backgroundColor: string;
}

interface TelegramData {
  initData: TelegramInitData | undefined;
  miniApp: TelegramMiniApp | undefined;
  isInTelegram: boolean;
}

export function useTelegramData(): TelegramData {
  const [telegramData, setTelegramData] = useState<TelegramData>({
    initData: undefined,
    miniApp: undefined,
    isInTelegram: false,
  });

  useEffect(() => {
    // Check if we're in Telegram environment
    const tgWebApp = (window as any).Telegram?.WebApp;
    const isInTelegram = !!tgWebApp;
    
    if (isInTelegram) {
      console.log('Telegram WebApp detected, version:', tgWebApp.version);
      
      // Extract initData from initDataUnsafe (this is safe as we're just reading user info)
      const initData: TelegramInitData | undefined = tgWebApp.initDataUnsafe;
      
      // Create a simplified miniApp interface
      const miniApp: TelegramMiniApp = {
        ready: () => tgWebApp.ready(),
        sendData: (data: string) => tgWebApp.sendData(data),
        close: () => tgWebApp.close(),
        expand: () => tgWebApp.expand(),
        version: tgWebApp.version || 'unknown',
        platform: tgWebApp.platform || 'unknown',
        colorScheme: tgWebApp.colorScheme || 'light',
        themeParams: tgWebApp.themeParams || {},
        isExpanded: tgWebApp.isExpanded || false,
        isClosingConfirmationEnabled: tgWebApp.isClosingConfirmationEnabled || false,
        headerColor: tgWebApp.headerColor || '#000000',
        backgroundColor: tgWebApp.backgroundColor || '#ffffff',
      };

      setTelegramData({
        initData,
        miniApp,
        isInTelegram: true,
      });
    } else {
      console.log('Running outside Telegram, using fallback mode');
      setTelegramData({
        initData: undefined,
        miniApp: undefined,
        isInTelegram: false,
      });
    }
  }, []);

  return telegramData;
}