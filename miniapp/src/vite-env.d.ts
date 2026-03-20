/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAYER_URL?: string
  readonly VITE_FRONTEND_URL?: string
  readonly VITE_STARKNET_RPC_URL?: string
  readonly VITE_STARKNET_CHAIN_ID?: string
  readonly VITE_TELEGRAM_BOT_USERNAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}