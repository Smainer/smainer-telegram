interface ImportMetaEnv {
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

type TelegramWebApp = {
  sendData?: (data: string) => void;
  openLink?: (url: string) => void;
};

type StarknetInjectedWallet = {
  enable: (options?: { starknetVersion?: string }) => Promise<string[] | string>;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
    starknet_braavos?: StarknetInjectedWallet;
    starknet_argentX?: StarknetInjectedWallet;
  }
}

export {};