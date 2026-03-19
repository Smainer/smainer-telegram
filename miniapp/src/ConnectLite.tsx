import React, { useState } from 'react'

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

  // Address validation regex
  const ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/
  const runtimeWindow = window as WindowWithWallets
  const telegramWebApp = runtimeWindow.Telegram?.WebApp
  const viteEnv = (import.meta as ImportMeta & { env?: { VITE_TELEGRAM_BOT_USERNAME?: string } }).env

  // Diagnostic information
  const isInTelegram = Boolean(telegramWebApp)
  const currentUrl = window.location.href
  const userAgent = navigator.userAgent.substring(0, 100) + (navigator.userAgent.length > 100 ? '...' : '')
  const urlParams = new URLSearchParams(window.location.search)
  const shouldReturnToTelegram = urlParams.get('return') === 'telegram'
  const botUsername = viteEnv?.VITE_TELEGRAM_BOT_USERNAME || 'smainer_ai_bot'
  const browserConnectUrl = `${window.location.origin}/?mode=connect&return=telegram`
  const braavosConnectUrl = `https://link.braavos.app/dapp/${window.location.host}/?mode=connect&return=telegram`
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

  const finalizeWalletLink = (connectedAddress: string, walletType: string) => {
    persistWalletState(connectedAddress, walletType)

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

  if (success) {
    return (
      <div style={{ minHeight: '100vh', padding: '18px 14px', background: '#070c15', color: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: '480px', margin: '0 auto' }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(148, 163, 184, 0.28)',
            borderRadius: '18px',
            padding: '24px',
            marginBottom: '14px',
            textAlign: 'center'
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '999px',
              margin: '0 auto 14px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(16, 185, 129, 0.14)',
              border: '1px solid rgba(16, 185, 129, 0.35)'
            }}>
              <span style={{ fontSize: '24px' }}>✓</span>
            </div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '28px', lineHeight: 1.15 }}>Wallet Linked</h2>
            <p style={{ margin: '0', color: '#cbd5e1', lineHeight: 1.5, fontSize: '14px' }}>
              You are ready. Return to Telegram chat or open the full Smainer app now.
            </p>
          </div>

          <div style={{ background: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.26)', padding: '14px', borderRadius: '14px', fontSize: '12px', textAlign: 'left' }}>
            <div style={{ color: '#94a3b8', marginBottom: '6px', letterSpacing: '0.03em' }}>CONNECTED ADDRESS</div>
            <div style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: '#7dd3fc' }}>
              {address}
            </div>
          </div>

          <div style={{ marginTop: '14px', display: 'grid', gap: '10px' }}>
            <button
              type="button"
              onClick={() => {
                try {
                  runtimeWindow.Telegram?.WebApp?.close?.()
                } catch {
                  window.history.back()
                }
              }}
              style={{
                width: '100%',
                padding: '14px 18px',
                borderRadius: '12px',
                border: 'none',
                color: '#fff',
                fontWeight: 700,
                fontSize: '15px',
                background: '#B5A082'
              }}
            >
              Return To Telegram Chat
            </button>

            <button
              type="button"
              onClick={() => {
                window.location.assign('/')
              }}
              style={{
                width: '100%',
                padding: '13px 18px',
                borderRadius: '12px',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                color: '#e2e8f0',
                fontWeight: 600,
                fontSize: '14px',
                background: 'rgba(15, 23, 42, 0.8)'
              }}
            >
              Open Full Smainer App
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', padding: '18px 14px', background: '#070c15', color: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        <div style={{
          marginBottom: '16px',
          borderRadius: '18px',
          border: '1px solid rgba(148, 163, 184, 0.26)',
          background: '#0f172a',
          padding: '22px'
        }}>
          <div style={{ marginBottom: '8px', color: '#6ee7b7', fontSize: '11px', letterSpacing: '0.22em', textTransform: 'uppercase' }}>
            Smainer Protocol
          </div>
          <h1 style={{ margin: '0', fontSize: '30px', lineHeight: 1.1 }}>
            Connect Your Starknet Wallet
          </h1>
          <p style={{ margin: '10px 0 0 0', fontSize: '14px', lineHeight: '1.5', color: '#cbd5e1' }}>
            One secure link. Instant access to private AI compute and on-chain settlement in Telegram.
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'grid', gap: '12px' }}>
            {injectedWallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                onClick={() => handleInjectedConnect(wallet.id, wallet.provider)}
                disabled={isConnecting}
                style={{
                  width: '100%',
                  padding: '15px 18px',
                  background: '#06B6D4',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: 700,
                  cursor: isConnecting ? 'wait' : 'pointer'
                }}
              >
                {isConnecting ? 'Connecting...' : `${wallet.icon} Connect with ${wallet.label}`}
              </button>
            ))}

            <button
              type="button"
              onClick={() => openBrowserLink(braavosConnectUrl)}
              style={{
                width: '100%',
                padding: '13px 18px',
                background: 'rgba(15, 23, 42, 0.92)',
                color: '#ffffff',
                border: '1px solid rgba(148, 163, 184, 0.35)',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Open in Braavos App
            </button>

            <button
              type="button"
              onClick={() => openBrowserLink(browserConnectUrl)}
              style={{
                width: '100%',
                padding: '13px 18px',
                background: 'transparent',
                color: '#cbd5e1',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Open in Browser Wallet
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '14px', background: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.22)', borderRadius: '14px', padding: '14px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="address" style={{ 
              display: 'block', 
              marginBottom: '8px', 
              fontSize: '14px', 
              fontWeight: 600,
              color: '#cbd5e1'
            }}>
              Manual Fallback: Starknet Wallet Address
            </label>
            <input
              id="address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              style={{
                width: '100%',
                padding: '12px 16px',
                borderRadius: '10px',
                border: error ? '2px solid #f87171' : '1px solid rgba(148, 163, 184, 0.35)',
                background: '#111827',
                color: '#e6e6e6',
                fontSize: '16px',
                fontFamily: 'monospace',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {error && (
            <div style={{
              background: '#7f1d1d',
              color: '#fecaca',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '14px 18px',
              background: '#B5A082',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Link Wallet
          </button>
        </form>

        <details style={{ background: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.22)', padding: '12px', borderRadius: '12px', fontSize: '12px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#94a3b8' }}>Diagnostics</summary>
          <div style={{ marginTop: '10px', color: '#cbd5e1', lineHeight: 1.6 }}>
            <div><strong>Telegram WebApp:</strong> <span style={{ color: isInTelegram ? '#34d399' : '#f87171' }}>{isInTelegram ? 'Yes' : 'No'}</span></div>
            <div><strong>Injected Wallets:</strong> {injectedWallets.length > 0 ? injectedWallets.map((wallet) => wallet.label).join(', ') : 'None detected'}</div>
            <div><strong>URL:</strong> <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{currentUrl}</span></div>
            <div><strong>User Agent:</strong> <span style={{ fontFamily: 'monospace' }}>{userAgent}</span></div>
          </div>
        </details>
      </div>
    </div>
  )
}