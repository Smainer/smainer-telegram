import React, { useState } from 'react'

interface ConnectLiteProps {}

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
      icon: '🛡️',
      provider: runtimeWindow.starknet_braavos,
    },
    {
      id: 'argentx',
      label: 'Argent X',
      icon: '🔷',
      provider: runtimeWindow.starknet_argentX,
    },
  ].filter((wallet) => wallet.provider)

  const finalizeWalletLink = (connectedAddress: string, walletType: string) => {
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
      window.location.assign(`https://t.me/${botUsername}?start=link_${connectedAddress}`)
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
      const connectedAddress = typeof accounts === 'string' ? accounts : accounts[0]

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
      <div style={{ 
        minHeight: '100vh', 
        padding: '24px 16px', 
        background: '#1f233b', 
        color: '#e6e6e6', 
        fontFamily: 'system-ui, sans-serif' 
      }}>
        <div style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
          <div style={{ 
            background: '#065f46', 
            color: '#d1fae5', 
            padding: '20px', 
            borderRadius: '12px', 
            marginBottom: '24px' 
          }}>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>✅ Wallet Connected!</h2>
            <p style={{ margin: '0', fontSize: '14px' }}>
              Your wallet has been linked to your Smainer account.
              You can now close this window and return to the chat.
            </p>
          </div>
          
          <div style={{ 
            background: '#374151', 
            padding: '16px', 
            borderRadius: '8px', 
            fontSize: '12px',
            textAlign: 'left'
          }}>
            <div><strong>Connected Address:</strong></div>
            <div style={{ 
              fontFamily: 'monospace', 
              wordBreak: 'break-all', 
              marginTop: '8px',
              color: '#a78bfa'
            }}>
              {address}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ 
      minHeight: '100vh', 
      padding: '24px 16px', 
      background: '#1f233b', 
      color: '#e6e6e6', 
      fontFamily: 'system-ui, sans-serif' 
    }}>
      <div style={{ maxWidth: '480px', margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ margin: '0 0 16px 0', fontSize: '26px', color: '#a78bfa' }}>
            Connect Your Wallet
          </h1>
          <p style={{ margin: '0', fontSize: '16px', lineHeight: '1.5', color: '#d1d5db' }}>
            Connect with a Starknet wallet in one tap, or paste your address as a fallback.
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'grid', gap: '12px' }}>
            {injectedWallets.map((wallet) => (
              <button
                key={wallet.id}
                type="button"
                onClick={() => handleInjectedConnect(wallet.id, wallet.provider)}
                disabled={isConnecting}
                style={{
                  width: '100%',
                  padding: '14px 20px',
                  background: '#7c3aed',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
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
                padding: '14px 20px',
                background: '#334155',
                color: '#ffffff',
                border: '1px solid #475569',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              🛡️ Open in Braavos App
            </button>

            <button
              type="button"
              onClick={() => openBrowserLink(browserConnectUrl)}
              style={{
                width: '100%',
                padding: '14px 20px',
                background: 'transparent',
                color: '#cbd5e1',
                border: '1px solid #475569',
                borderRadius: '8px',
                fontSize: '15px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Open in Browser Wallet
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '32px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="address" style={{ 
              display: 'block', 
              marginBottom: '8px', 
              fontSize: '14px', 
              fontWeight: '500' 
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
                borderRadius: '8px',
                border: error ? '2px solid #ef4444' : '1px solid #4b5563',
                background: '#374151',
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
              padding: '14px 20px',
              background: '#7c3aed',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#6d28d9'}
            onMouseOut={(e) => e.currentTarget.style.background = '#7c3aed'}
          >
            Link Wallet
          </button>
        </form>

        {/* Diagnostic Block */}
        <div style={{ 
          background: '#374151', 
          padding: '16px', 
          borderRadius: '8px', 
          fontSize: '12px',
          border: '1px solid #4b5563'
        }}>
          <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '600' }}>
            🔍 Diagnostics
          </div>
          
          <div style={{ marginBottom: '8px' }}>
            <strong>Telegram WebApp:</strong>{' '}
            <span style={{ color: isInTelegram ? '#10b981' : '#ef4444' }}>
              {isInTelegram ? 'Yes' : 'No'}
            </span>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <strong>Injected Wallets:</strong>{' '}
            <span style={{ color: injectedWallets.length > 0 ? '#10b981' : '#f59e0b' }}>
              {injectedWallets.length > 0 ? injectedWallets.map((wallet) => wallet.label).join(', ') : 'None detected'}
            </span>
          </div>
          
          <div style={{ marginBottom: '8px' }}>
            <strong>URL:</strong>{' '}
            <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {currentUrl}
            </span>
          </div>
          
          <div>
            <strong>User Agent:</strong>{' '}
            <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
              {userAgent}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}