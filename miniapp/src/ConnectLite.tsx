import React, { useState } from 'react'

interface ConnectLiteProps {}

export default function ConnectLite({}: ConnectLiteProps) {
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // Address validation regex
  const ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/

  // Diagnostic information
  const isInTelegram = Boolean(window.Telegram?.WebApp)
  const currentUrl = window.location.href
  const userAgent = navigator.userAgent.substring(0, 100) + (navigator.userAgent.length > 100 ? '...' : '')

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

    // If running in Telegram WebApp, send data back
    if (isInTelegram && window.Telegram?.WebApp?.sendData) {
      try {
        const data = {
          action: 'wallet_connect',
          address: trimmedAddress,
          wallet_type: 'manual'
        }
        window.Telegram.WebApp.sendData(JSON.stringify(data))
        setSuccess(true)
      } catch (err) {
        setError('Failed to send data to Telegram bot')
        console.error('Telegram sendData error:', err)
      }
    } else {
      setError('This feature only works inside Telegram WebApp')
    }
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
            Enter your Starknet wallet address to link it with your Smainer account for compute rewards and task submissions.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ marginBottom: '32px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="address" style={{ 
              display: 'block', 
              marginBottom: '8px', 
              fontSize: '14px', 
              fontWeight: '500' 
            }}>
              Starknet Wallet Address
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