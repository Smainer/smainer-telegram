import React, { useEffect, useState } from 'react'

interface ConnectLiteProps {}

const WALLET_STORAGE_KEY = 'smainer_connected_wallet'

type StarknetInjectedWallet = {
  enable: (options?: { starknetVersion?: string }) => Promise<string[] | string>
}

type TelegramWebApp = {
  sendData?: (data: string) => void
  openLink?: (url: string) => void
}

type WindowWithWallets = Window & {
  Telegram?: { WebApp?: TelegramWebApp }
  starknet_braavos?: StarknetInjectedWallet
  starknet_argentX?: StarknetInjectedWallet
}

function encodeAddressForStartPayload(address: string): string {
  const normalized = address.trim().toLowerCase()
  const hex = normalized.startsWith('0x') ? normalized.slice(2) : normalized
  const padded = hex.padStart(64, '0')
  const bytes = new Uint8Array(padded.match(/.{1,2}/g)!.map((pair) => parseInt(pair, 16)))
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export default function ConnectLite({}: ConnectLiteProps) {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  const ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/
  const runtimeWindow = window as WindowWithWallets
  const telegramWebApp = runtimeWindow.Telegram?.WebApp
  const viteEnv = (import.meta as ImportMeta & { env?: { VITE_TELEGRAM_BOT_USERNAME?: string } }).env

  const isInTelegram = Boolean(telegramWebApp)
  const currentUrl = window.location.href
  const userAgent = navigator.userAgent.substring(0, 100) + (navigator.userAgent.length > 100 ? '...' : '')
  const urlParams = new URLSearchParams(window.location.search)
  const shouldReturnToTelegram = urlParams.get('return') === 'telegram'
  const botUsername = viteEnv?.VITE_TELEGRAM_BOT_USERNAME || 'smainer_ai_bot'
  const browserConnectUrl = `${window.location.origin}/connect?return=telegram`
  const braavosConnectUrl = `https://link.braavos.app/dapp/${window.location.host}/connect?return=telegram`
  const injectedWallets = [
    {
      id: 'braavos',
      label: 'Braavos',
      icon: 'B',
      provider: runtimeWindow.starknet_braavos,
    },
    {
      id: 'argentx',
      label: 'Argent X',
      icon: 'A',
      provider: runtimeWindow.starknet_argentX,
    },
  ].filter((wallet) => wallet.provider)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WALLET_STORAGE_KEY)
      if (!raw) {
        return
      }

      const parsed = JSON.parse(raw) as { address?: string }
      const storedAddress = parsed.address?.trim()
      if (!storedAddress || !ADDRESS_REGEX.test(storedAddress)) {
        window.localStorage.removeItem(WALLET_STORAGE_KEY)
        return
      }

      setAddress(storedAddress)
      setSuccess(true)
    } catch {
      window.localStorage.removeItem(WALLET_STORAGE_KEY)
    }
  }, [])

  const persistWalletState = (connectedAddress: string, walletType: string) => {
    try {
      window.localStorage.setItem(
        WALLET_STORAGE_KEY,
        JSON.stringify({
          address: connectedAddress,
          type: walletType,
          balance_strk: '0',
          balance_smainer: '0',
        })
      )
    } catch {
      // Best effort persistence only.
    }
  }

  const broadcastWallet = (connectedAddress: string, walletType: string) => {
    try {
      const channel = new BroadcastChannel('smainer-wallet')
      channel.postMessage({
        action: 'wallet_connect',
        address: connectedAddress,
        wallet_type: walletType,
      })
      channel.close()
    } catch {
      // BroadcastChannel not supported
    }
  }

  const finalizeWalletLink = (connectedAddress: string, walletType: string) => {
    persistWalletState(connectedAddress, walletType)
    broadcastWallet(connectedAddress, walletType)

    if (isInTelegram && telegramWebApp?.sendData) {
      try {
        telegramWebApp.sendData(JSON.stringify({
          action: 'wallet_connect',
          address: connectedAddress,
          wallet_type: walletType,
        }))
        setAddress(connectedAddress)
        setSuccess(true)
        return
      } catch (err) {
        setError('Failed to send data to Telegram bot')
        console.error('Telegram sendData error:', err)
        return
      }
    }

    if (shouldReturnToTelegram) {
      const encodedAddress = encodeAddressForStartPayload(connectedAddress)
      window.location.assign(`https://t.me/${botUsername}?start=linkb_${encodedAddress}`)
      return
    }

    setAddress(connectedAddress)
    setSuccess(true)
  }

  const handleInjectedConnect = async (walletType: string, provider?: StarknetInjectedWallet) => {
    if (!provider) {
      setError(`${walletType} wallet is not available in this browser`)
      return
    }

    try {
      setIsConnecting(true)
      setError('')
      const accounts = await provider.enable({ starknetVersion: 'v5' })
      const connectedAddress = typeof accounts === 'string'
        ? accounts
        : Array.isArray(accounts) && accounts.length > 0
          ? accounts[0]
          : undefined

      if (!connectedAddress || !ADDRESS_REGEX.test(connectedAddress.trim())) {
        throw new Error('Wallet returned an invalid Starknet address')
      }

      finalizeWalletLink(connectedAddress.trim(), walletType)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Wallet connection failed'
      setError(message)
    } finally {
      setIsConnecting(false)
    }
  }

  const openBrowserLink = (targetUrl: string) => {
    try {
      if (telegramWebApp?.openLink) {
        telegramWebApp.openLink(targetUrl)
        return
      }
    } catch {
      // Fallback to standard browser navigation.
    }

    window.open(targetUrl, '_blank', 'noopener,noreferrer')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    
    if (!address.trim()) {
      setError('Please enter a wallet address')
      return
    }

    if (!ADDRESS_REGEX.test(address.trim())) {
      setError('Invalid Starknet address format. Must start with 0x followed by 1-64 hex characters.')
      return
    }

    const trimmedAddress = address.trim()
    finalizeWalletLink(trimmedAddress, 'manual')
  }

  // ─── Success State ───
  if (success) {
    return (
      <div className="min-h-screen p-4 pt-10" style={{ background: '#09090B', color: '#FAFAFA', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <div className="max-w-md mx-auto">
          <div className="card-elevated p-6 text-center mb-4 animate-fade-in">
            <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
                 style={{ background: 'rgba(16, 185, 129, 0.12)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <svg className="w-7 h-7" fill="none" stroke="#10B981" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold mb-2">Wallet Linked</h2>
            <p className="text-sm leading-relaxed" style={{ color: '#A1A1AA' }}>
              Submit tasks in Telegram or open full app.
            </p>
          </div>

          <div className="card-elevated p-4 mb-4 animate-fade-in stagger-1">
            <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: '#71717A' }}>Connected Address</div>
            <div className="font-mono text-xs break-all" style={{ color: '#22D3EE' }}>
              {address}
            </div>
          </div>

          <div className="space-y-3 animate-fade-in stagger-2">
            {isInTelegram ? (
              <button
                type="button"
                onClick={() => {
                  try {
                    const webApp = runtimeWindow.Telegram?.WebApp as any;
                    webApp?.close?.();
                  } catch {
                    window.history.back()
                  }
                }}
                className="w-full py-3.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 glow-champagne"
                style={{ background: '#B5A082', color: '#000' }}
              >
                Return To Telegram Chat
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const encodedAddr = encodeAddressForStartPayload(address)
                  window.location.assign(`https://t.me/${botUsername}?start=linkb_${encodedAddr}`)
                }}
                className="w-full py-3.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 glow-champagne"
                style={{ background: '#B5A082', color: '#000' }}
              >
                Return to Telegram
              </button>
            )}

            <button
              type="button"
              onClick={() => { window.location.assign('/') }}
              className="w-full py-3 px-5 rounded-xl font-semibold text-sm transition-all duration-200"
              style={{ background: '#111111', color: '#A1A1AA', border: '1px solid #27272A' }}
            >
              Open Full Smainer App
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Connect State ───
  return (
    <div className="min-h-screen p-4 pt-10" style={{ background: '#09090B', color: '#FAFAFA', fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="max-w-md mx-auto">
        {/* Hero */}
        <div className="card-elevated p-6 mb-4 animate-fade-in">
          <div className="flex items-center space-x-2 mb-3">
            <div className="w-6 h-6 rounded-lg" style={{ background: 'linear-gradient(135deg, #B5A082, #22D3EE)' }} />
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: '#B5A082' }}>
              Smainer Protocol
            </span>
          </div>
          <h1 className="text-2xl font-semibold mb-2">
            Link Starknet Wallet
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: '#A1A1AA' }}>
            {isInTelegram
              ? 'Paste your Starknet wallet address below to connect. Wallet extensions are not available inside Telegram.'
              : 'Submit compute tasks for $STRK. Verified on-chain.'}
          </p>
        </div>

        {/* Injected wallets (browser only) */}
        {!isInTelegram && (
          <div className="space-y-3 mb-4 animate-fade-in stagger-1">
            {injectedWallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                onClick={() => handleInjectedConnect(wallet.id, wallet.provider)}
                disabled={isConnecting}
                className="w-full py-3.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 disabled:opacity-50"
                style={{ background: '#22D3EE', color: '#000' }}
              >
                {isConnecting ? 'Requesting Access...' : `Connect with ${wallet.label}`}
              </button>
            ))}

            <button
              type="button"
              onClick={() => openBrowserLink(braavosConnectUrl)}
              className="w-full py-3 px-5 rounded-xl font-semibold text-sm transition-all duration-200"
              style={{ background: '#111111', color: '#FAFAFA', border: '1px solid #27272A' }}
            >
              Open in Braavos App
            </button>

            <button
              type="button"
              onClick={() => openBrowserLink(browserConnectUrl)}
              className="w-full py-3 px-5 rounded-xl font-medium text-sm transition-all duration-200"
              style={{ background: 'transparent', color: '#A1A1AA', border: '1px solid #27272A' }}
            >
              Open in Browser Wallet
            </button>
          </div>
        )}

        {/* Manual address form */}
        <form onSubmit={handleSubmit} className="card-elevated p-5 mb-4 animate-fade-in stagger-2">
          <div className="mb-4">
            <label htmlFor="address" className="block mb-2 text-sm font-medium" style={{ color: '#A1A1AA' }}>
              {isInTelegram ? 'Paste your Starknet address from Braavos or Argent X' : 'Starknet Address'}
            </label>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              className="w-full px-4 py-3 rounded-xl text-base font-mono transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-[#B5A082]"
              style={{
                background: '#1A1A1A',
                color: '#FAFAFA',
                border: error ? '1px solid #EF4444' : '1px solid #27272A',
              }}
            />
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#FCA5A5', border: '1px solid rgba(239,68,68,0.2)' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3.5 px-5 rounded-xl font-semibold text-sm transition-all duration-200 glow-champagne"
            style={{ background: '#B5A082', color: '#000' }}
          >
            Link Wallet
          </button>
        </form>

        {/* Diagnostics */}
        <details className="card-elevated p-4 text-xs animate-fade-in stagger-3">
          <summary className="cursor-pointer font-semibold" style={{ color: '#71717A' }}>Diagnostics</summary>
          <div className="mt-3 space-y-1.5" style={{ color: '#A1A1AA', lineHeight: '1.6' }}>
            <div><strong>Telegram WebApp:</strong> <span style={{ color: isInTelegram ? '#10B981' : '#EF4444' }}>{isInTelegram ? 'Yes' : 'No'}</span></div>
            <div><strong>Injected Wallets:</strong> {injectedWallets.length > 0 ? injectedWallets.map((wallet) => wallet.label).join(', ') : 'None detected'}</div>
            <div><strong>URL:</strong> <span className="font-mono break-all">{currentUrl}</span></div>
            <div><strong>User Agent:</strong> <span className="font-mono">{userAgent}</span></div>
          </div>
        </details>
      </div>
    </div>
  )
}
