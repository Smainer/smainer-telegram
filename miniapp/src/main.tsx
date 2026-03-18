import React from 'react'
import ReactDOM from 'react-dom/client'
import { StarknetConfig, publicProvider } from '@starknet-react/core'

import App from './App.tsx'
import { TelegramProvider } from './components/providers/TelegramProvider'
import { starknetConfig } from './lib/starknet'
import './index.css'

// Ensure the DOM is ready
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TelegramProvider>
      <StarknetConfig config={starknetConfig}>
        <App />
      </StarknetConfig>
    </TelegramProvider>
  </React.StrictMode>,
)