import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import './index.css'

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message?: string; stackHint?: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message,
      stackHint: error.stack ? error.stack.split('\n').slice(0, 2).join('\n') : undefined,
    }
  }

  componentDidCatch(error: Error) {
    console.error('Miniapp render failed:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', padding: '16px', background: '#1f233b', color: '#e6e6e6', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ maxWidth: '640px', margin: '0 auto' }}>
            <h2 style={{ margin: '0 0 12px 0', fontSize: '22px' }}>Smainer Miniapp Render Error</h2>
            <p style={{ margin: '0 0 12px 0', lineHeight: 1.4 }}>
              {this.state.message || 'The app failed while rendering.'}
            </p>
            <p style={{ margin: 0, lineHeight: 1.4, fontSize: '13px', color: '#b8bfd6' }}>
              Reopen the miniapp from Telegram and retry the payment flow if this keeps happening.
            </p>
            {this.state.stackHint ? (
              <pre style={{ marginTop: '12px', whiteSpace: 'pre-wrap', background: '#101426', padding: '10px', borderRadius: '8px', fontSize: '12px', color: '#b8bfd6' }}>
                {this.state.stackHint}
              </pre>
            ) : null}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

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
    const urlParams = new URLSearchParams(window.location.search)
    const isLegacyConnectMode = urlParams.get('mode') === 'connect'
    const isLegacyConnectRoute = window.location.pathname === '/connect'

    const rootElement = document.getElementById('root')
    if (!rootElement) {
      throw new Error('Missing #root element')
    }

    // Normalize stale connect-only entry points into the single SPA flow.
    if (isLegacyConnectMode || isLegacyConnectRoute) {
      urlParams.delete('mode')
      const nextSearch = urlParams.toString()
      const nextUrl = nextSearch ? `/?${nextSearch}` : '/'
      window.location.replace(nextUrl)
      return
    }

    const [{ default: App }, { TelegramProvider }, { StarknetConfig }, { starknetConfig }] = await Promise.all([
      import('./App'),
      import('./components/providers/TelegramProvider'),
      import('@starknet-react/core'),
      import('./lib/starknet'),
    ])

    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <AppErrorBoundary>
          <TelegramProvider>
            <StarknetConfig {...starknetConfig}>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </StarknetConfig>
          </TelegramProvider>
        </AppErrorBoundary>
      </React.StrictMode>,
    )
  } catch (error) {
    console.error('Miniapp bootstrap failed:', error)
    const message = error instanceof Error ? error.message : String(error)
    const details = error instanceof Error ? error.stack : undefined
    renderBootstrapError(message, details)
  }
}

bootstrap()
