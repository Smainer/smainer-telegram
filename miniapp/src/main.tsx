import React from 'react'
import ReactDOM from 'react-dom/client'

import './index.css'

function renderBootstrapError(message: string, details?: string) {
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  // Clear entire root including loading placeholder
  root.innerHTML = `
    <div style="min-height:100vh;padding:16px;background:#1f233b;color:#e6e6e6;font-family:system-ui,sans-serif;">
      <div style="max-width:640px;margin:0 auto;">
        <h2 style="margin:0 0 12px 0;font-size:22px;">Smainer Miniapp Startup Error</h2>
        <p style="margin:0 0 10px 0;line-height:1.4;">${message}</p>
        <p style="margin:0 0 12px 0;line-height:1.4;font-size:13px;color:#b8bfd6;">
          Open this URL with <code>?debug=1</code> and share this screen.
        </p>
        ${details ? `<pre style="white-space:pre-wrap;background:#101426;padding:12px;border-radius:8px;font-size:12px;overflow:auto;">${details}</pre>` : ''}
      </div>
    </div>
  `
}

async function bootstrap() {
  // Remove the pre-JS loading placeholder once JS is running
  const loadingPlaceholder = document.getElementById('js-loading')
  if (loadingPlaceholder) {
    loadingPlaceholder.style.display = 'none'
  }

  try {
    // Check if we're in connect mode from URL parameters
    const urlParams = new URLSearchParams(window.location.search)
    const isConnectMode = urlParams.get('mode') === 'connect'

    const rootElement = document.getElementById('root')
    if (!rootElement) {
      throw new Error('Missing #root element')
    }

    if (isConnectMode) {
      // Connect mode: Load only ConnectLite component (no Starknet imports)
      const { default: ConnectLite } = await import('./ConnectLite.tsx')
      
      ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
          <ConnectLite />
        </React.StrictMode>,
      )
    } else {
      // Normal mode: Load full app with Starknet and all providers
      const [{ default: App }, { TelegramProvider }, { StarknetConfig }, { starknetConfig }] = await Promise.all([
        import('./App.tsx'),
        import('./components/providers/TelegramProvider'),
        import('@starknet-react/core'),
        import('./lib/starknet'),
      ])

      ReactDOM.createRoot(rootElement).render(
        <React.StrictMode>
          <TelegramProvider>
            <StarknetConfig config={starknetConfig}>
              <App />
            </StarknetConfig>
          </TelegramProvider>
        </React.StrictMode>,
      )
    }
  } catch (error) {
    console.error('Miniapp bootstrap failed:', error)
    const message = error instanceof Error ? error.message : String(error)
    const details = error instanceof Error ? error.stack : undefined
    renderBootstrapError(message, details)
  }
}

bootstrap()