import React, { useEffect, useState } from 'react';

interface WalletRedirectPageProps {
  wallet: string;
  deepLink: string;
}

/**
 * Wave 2: Auto-redirects to wallet deep link. Shows minimal loading state.
 * Falls back to a tappable <a> after 3s for iOS universal link requirement
 * (programmatic navigation does NOT trigger universal links on iOS).
 */
export function WalletRedirectPage({ wallet, deepLink }: WalletRedirectPageProps) {
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    // Attempt programmatic redirect (works on Android, some desktop browsers)
    window.location.href = deepLink;

    // If we're still here after 3s, iOS blocked the redirect — show tap fallback
    const timer = setTimeout(() => setShowFallback(true), 3000);
    return () => clearTimeout(timer);
  }, [deepLink]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: '#0A0A0F',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {!showFallback ? (
        <>
          {/* Spinner while auto-redirect fires */}
          <div style={{ marginBottom: '16px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
              <circle cx="12" cy="12" r="10" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round" opacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          </div>
          <p style={{ fontSize: '14px', color: '#A1A1AA' }}>
            Redirecting to wallet...
          </p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </>
      ) : (
        <>
          {/* Fallback: tappable link for iOS universal link requirement */}
          <p style={{
            fontSize: '14px', color: '#A1A1AA', textAlign: 'center',
            margin: '0 0 20px 0', maxWidth: '280px', lineHeight: '1.5',
          }}>
            Tap to open your wallet
          </p>
          <a
            href={deepLink}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              width: '100%',
              maxWidth: '320px',
              padding: '16px 24px',
              borderRadius: '14px',
              background: wallet === 'braavos'
                ? 'linear-gradient(135deg, #F5841F, #FFB84D)'
                : 'linear-gradient(135deg, #FF875B, #FF6B4A)',
              color: wallet === 'braavos' ? '#000' : '#fff',
              fontSize: '17px',
              fontWeight: 600,
              textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(245, 132, 31, 0.4)',
            }}
          >
            Open Wallet
          </a>
        </>
      )}
    </div>
  );
}