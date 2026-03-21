# ⚡ Smainer Telegram App

Starknet AI tasks through Telegram. Connect wallet, run compute tasks, pay with STRK tokens.

## � Current Features

- **🔗 Wallet Connect**: Argent X, Braavos, or Telegram Wallet support
- **🤖 AI Tasks**: Submit inference tasks through chat interface
- **🎨 Image Generate**: Create and optionally mint AI-generated images
- **📊 Status Monitor**: Check balances, tasks, and network status
- **💳 STRK Payment**: Pay for tasks with STRK tokens
- **📱 Mobile Optimized**: Works within Telegram mobile app

## Wallet Connect Flows (Current)

- Telegram WebApp connect: in Telegram, wallet data is returned with `WebApp.sendData`.
- External wallet connect: from `/?mode=connect`, users can open `Open in Braavos App` or `Open in Browser Wallet`.
- Return to bot: external connect runs with `?return=telegram` and redirects to `https://t.me/<bot>?start=linkb_<encoded_address>` after successful connection.
- Desktop/browser support: injected wallets (Braavos, Argent X) are available in connect mode, with manual address entry as fallback.

## Required Environment Variables (Wallet Return)

- `VITE_TELEGRAM_BOT_USERNAME`: bot username used for deep-link return redirects.

## 🚀 Deployment

### Vercel Deployment (Recommended)

1. **Connect Repository to Vercel**
   ```bash
   # Install Vercel CLI (optional)
   npm i -g vercel
   
   # Deploy from project directory
   cd miniapp
   vercel
   ```

2. **Environment Variables**
   Set these in Vercel Dashboard → Project → Settings → Environment Variables:
   ```env
   VITE_RELAYER_URL=https://your-relayer-domain.com
   VITE_STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
   VITE_SMAINER_CONTRACT_ADDRESS=0x...
   VITE_NFT_CONTRACT_ADDRESS=0x...
   ```

3. **Telegram Bot Setup**
   - Get your Vercel deployment URL (e.g., `https://smainer-miniapp.vercel.app`)
   - Set Mini App URL in [@BotFather](https://t.me/BotFather):
     ```
     /setmenubutton
     @your_bot_name
     Smainer AI
     https://smainer-miniapp.vercel.app
     ```

4. **Custom Domain (Optional)**
   - Add custom domain in Vercel Dashboard
   - Update Bot's Mini App URL to use custom domain

### Alternative Deployment Options

#### Netlify
```bash
# Build locally
npm run build

# Deploy to Netlify
# Upload the 'dist' folder via Netlify UI
# Or use Netlify CLI:
netlify deploy --prod --dir=dist
```

#### GitHub Pages
```bash
# Install gh-pages
npm install --save-dev gh-pages

# Add to package.json scripts
"deploy": "gh-pages -d dist"

# Build and deploy
npm run build
npm run deploy
```

### Production Checklist

- [ ] Environment variables configured
- [ ] HTTPS domain setup (required for Telegram Mini Apps)
- [ ] Bot Mini App URL updated
- [ ] Relayer API accessible from deployment
- [ ] Contract addresses are production values
- [ ] Analytics/monitoring configured

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Running [Smainer Relayer](../relayer/README.md)
- Deployed Starknet contracts

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.local.example .env.local

# Update environment variables
nano .env.local

# Start development server
npm run dev
```

### Environment Setup

Update `.env.local` with your configuration:

```env
# Relayer API
VITE_RELAYER_URL=http://localhost:8001

# Starknet Network
VITE_STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io

# Contract Addresses
VITE_SMAINER_CONTRACT_ADDRESS=0x...
VITE_NFT_FACTORY_ADDRESS=0x...
```

## 📱 Telegram Integration

### Bot Setup

1. Create a new bot with [@BotFather](https://t.me/BotFather)
2. Set the Mini App URL: `/setmenubutton` → `https://your-domain.com`
3. Configure bot permissions and description

### Testing Locally

For local development with Telegram:

```bash
# Install ngrok for public tunnel
npm install -g ngrok

# Start the app
npm run dev

# In another terminal, create public tunnel
ngrok http 3000

# Use the ngrok URL with Telegram
```

## 🏗️ Architecture

Vite + React 18 SPA, deployed as static files on Vercel.

```
src/
├── main.tsx               # Vite entry, route-based code splitting
├── App.tsx                # Routes: /, /chat, /nft, /dashboard
├── index.css              # Global styles + CSS variables
├── ConnectLite.tsx        # Standalone wallet connect page
├── components/
│   ├── WalletConnect.tsx  # Wallet connection interface
│   ├── ChatInterface.tsx  # AI chat interface
│   ├── ModelSelector.tsx  # Model selection dropdown
│   ├── CostEstimator.tsx  # Cost calculation display
│   ├── NFTPreview.tsx     # NFT minting modal
│   └── DebugOverlay.tsx   # Dev-only debug panel
├── hooks/
│   ├── useRelayerAPI.ts   # Relayer HTTP client
│   └── useTelegramData.ts # Telegram WebApp SDK bridge
├── lib/
│   └── starknet.ts        # Starknet configuration
└── types/
    └── index.ts           # Shared types
```

## 🔧 Development

### Code Style

- **TypeScript**: Strict type checking enabled
- **ESLint**: Configured for React
- **Tailwind CSS**: Utility-first styling

### Testing

```bash
# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Run E2E tests (requires app running)
npm run test:e2e
```

### Build

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview
```

## 🎨 UI/UX Design

### Design System

- **Colors**: Custom Telegram theme integration with Smainer branding
- **Typography**: System fonts with accessible sizing
- **Components**: shadcn/ui component library
- **Responsive**: Mobile-first approach for Telegram interface

### Accessibility

- WCAG 2.1 AA compliant
- Keyboard navigation support
- Screen reader friendly
- High contrast mode support

## 🔐 Security

### Wallet Security

- **No Private Keys**: All signing handled by wallet extensions
- **Permission Checks**: User consent for all transactions
- **Address Validation**: Input sanitization and validation

### API Security

- **Request Signing**: Cryptographic verification of API calls
- **Rate Limiting**: Protection against abuse
- **CORS Configuration**: Restricted origins

## 🚀 Deployment

### Production Deployment

```bash
# Build and deploy via Vercel CLI
cd miniapp
vercel build --prod
vercel deploy --prebuilt --prod
```

### Environment Variables

Set these in your production environment (or in `vercel.json` env block):

```env
VITE_RELAYER_URL=https://api.smainer.ai
VITE_STARKNET_RPC_URL=https://api.cartridge.gg/x/starknet/mainnet
VITE_SMAINER_CONTRACT_ADDRESS=0x...
VITE_TELEGRAM_BOT_USERNAME=smainer_ai_bot
```

## 📊 Monitoring

### Analytics

- User interactions tracking
- Performance monitoring
- Error reporting with Sentry
- Usage analytics with Vercel Analytics

### Health Checks

Health is verified through the Relayer API endpoints (`/api/v1/health`).

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Commit changes: `git commit -m 'Add new feature'`
4. Push to branch: `git push origin feature/new-feature`
5. Submit a pull request

### Development Guidelines

- Follow TypeScript best practices
- Write tests for new components
- Update documentation for API changes
- Use conventional commit messages

## 📄 License

This project is part of the Smainer ecosystem. See [LICENSE](../../LICENSE) for details.

## 🆘 Support

- **Documentation**: [docs.smainer.io](https://docs.smainer.io)
- **Discord**: [discord.gg/smainer](https://discord.gg/smainer)
- **GitHub Issues**: For bugs and feature requests
- **Email**: support@smainer.io

## 🔗 Related Projects

- [Smainer Contracts](../contracts/) - Cairo smart contracts
- [Smainer Relayer](../relayer/) - Coordination service
- [Smainer Provider](../provider/) - Compute node daemon
- [Telegram Bot](../telegram-bot/) - CLI interface