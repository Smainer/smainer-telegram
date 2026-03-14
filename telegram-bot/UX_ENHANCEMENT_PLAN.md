# Smainer UX Enhancement Plan
## From CLI Bot to Web3 Mini App

## Current UX Pain Points

| Issue | Current State | Impact |
|-------|--------------|--------|
| **Manual wallet linking** | `/link 0x04a3...` copy-paste | Error-prone, intimidating for non-crypto users |
| **Token management** | Users handle $STRK approvals | Complex Web3 friction |
| **Text-only interface** | CLI commands in chat | Limited discoverability, poor visual hierarchy |
| **No visual content** | Only text prompts/responses | Missing image generation, NFT use cases |
| **No persistence** | Conversations lost | No user history, preferences |
| **External token dependency** | Relies on $STRK | Not building Smainer token ecosystem |

---

## Enhanced Architecture: Mini App + NFT + On-chain Storage

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Telegram Mini   │────▶│  Next.js Web App │────▶│  Smainer API    │
│ App (Frontend)  │◀────│  (Enhanced Bot)  │◀────│  (Enhanced)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │                        │                        │
         │               ┌────────▼─────────┐              │
         │               │ Wallet Connector │              │
         │               │ - Telegram Wallet│              │
         │               │ - ArgentX/Braavos │              │
         │               │ - WalletConnect  │              │
         │               └──────────────────┘              │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  User Profile   │────▶│   NFT Gallery    │────▶│ On-Chain Storage│
│  - Preferences  │     │  - Generated Art │     │ - Conversations │
│  - History      │     │  - Collections   │     │ - User Data     │
│  - $SMAINER     │     │  - Marketplace   │     │ - NFT Metadata  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

---

## 1. Telegram Mini App Frontend

### Enhanced User Journey

```
User opens Mini App
├─ 🔗 One-click wallet connection (Telegram Wallet/ArgentX)
├─ 🎨 Visual model picker (Small/Medium/Large with GPU info)
├─ 💬 Rich chat interface with history
├─ 🖼️ Image generation + instant NFT minting
├─ 💰 $SMAINER balance with auto-purchase
└─ 🏪 NFT gallery & marketplace integration
```

### Key Features

| Feature | Implementation |
|---------|---------------|
| **Wallet Connection** | Telegram Wallet API + starknet-react hooks |
| **Visual Chat** | Messages with image previews, model selection UI |
| **NFT Creation** | "Mint as NFT" button for AI-generated images |
| **On-chain Profiles** | Store preferences, conversation history on Starknet |
| **Token Integration** | Native $SMAINER token with auto-purchase flow |
| **Model Marketplace** | Browse available models by node performance |

---

## 2. Enhanced Smart Contract Architecture

### New Contracts

```cairo
// SMAINERToken.cairo - Native utility token
#[starknet::contract]
pub mod SMAINERToken {
    // ERC20 with additional features:
    // - Automatic bridging from $STRK
    // - Staking for compute credits
    // - Governance voting
}

// UserProfile.cairo - On-chain user data
#[starknet::contract] 
pub mod UserProfile {
    // Store user preferences, conversation history
    // NFT collection tracking
    // Compute credit balance
}

// NFTFactory.cairo - Mint AI-generated content
#[starknet::contract]
pub mod NFTFactory {
    // Mint images as NFTs
    // Royalty splits (Artist: AI model, Platform: Smainer)
    // Metadata stored on-chain or IPFS
}

// DataStorage.cairo - On-chain database
#[starknet::contract]
pub mod DataStorage {
    // Key-value storage paid with $SMAINER
    // Conversation history, user preferences
    // Encrypted private data
}
```

---

## 3. Mini App Technical Implementation

### Frontend Architecture

```
miniapp/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Main chat interface
│   │   ├── profile/              # User profile & settings  
│   │   ├── gallery/              # NFT gallery & marketplace
│   │   ├── models/               # Available AI models
│   │   └── wallet/               # Wallet connection
│   ├── components/
│   │   ├── ChatInterface.tsx     # Rich messaging UI
│   │   ├── ModelSelector.tsx     # Visual model picker
│   │   ├── NFTMinter.tsx         # One-click NFT creation
│   │   ├── WalletConnect.tsx     # Multi-wallet support  
│   │   └── TokenBalance.tsx      # $SMAINER balance display
│   ├── hooks/
│   │   ├── useSmainerWallet.ts   # Wallet integration
│   │   ├── useSmainerToken.ts    # Token operations
│   │   ├── useConversation.ts    # Chat persistence
│   │   └── useNFTFactory.ts      # NFT minting
│   └── lib/
│       ├── starknet.ts           # Starknet provider config
│       ├── contracts.ts          # Contract ABIs & addresses
│       └── storage.ts            # On-chain data helpers
```

### Integration with Existing Bot

```typescript
// Enhanced bot handlers for Mini App support
class EnhancedSmainerBot {
  // Traditional text interface for backward compatibility
  async handleTextPrompt(update: Update) { ... }
  
  // New: Mini App integration
  async handleWebAppData(update: Update) {
    const webAppData = update.message.web_app_data;
    const { action, payload } = JSON.parse(webAppData.data);
    
    switch(action) {
      case 'generate_image':
        return this.generateAndMintNFT(payload);
      case 'update_profile': 
        return this.updateOnChainProfile(payload);
      case 'purchase_credits':
        return this.purchaseComputeCredits(payload);
    }
  }
}
```

---

## 4. NFT Integration Flow

### Image Generation → NFT Pipeline

```
1. User generates image via AI model
   ├─ Enhanced prompt: "cyberpunk cat, digital art"
   ├─ Model processes via existing compute nodes
   └─ Returns high-res image

2. Mini App displays "Mint as NFT" option
   ├─ Preview NFT metadata
   ├─ Set royalty splits
   ├─ Choose collection
   └─ Estimate minting cost

3. One-click minting
   ├─ Upload image to IPFS via Pinata
   ├─ Call NFTFactory.mint() on-chain
   ├─ Auto-pay with $SMAINER balance
   └─ NFT appears in user gallery

4. Marketplace integration
   ├─ List NFT for sale (optional)
   ├─ Set price in $SMAINER
   ├─ Royalties flow to AI node operator
   └─ Platform fee to Smainer treasury
```

### NFT Metadata Schema

```json
{
  "name": "AI Generated Art #1234", 
  "description": "Generated by SmainerAI using model llama3.1:8b",
  "image": "ipfs://QmXXX...",
  "attributes": [
    {"trait_type": "AI Model", "value": "llama3.1:8b"},
    {"trait_type": "Provider", "value": "node-gpu-123"},
    {"trait_type": "Generation Time", "value": "2.3s"},
    {"trait_type": "Prompt", "value": "cyberpunk cat, digital art"}
  ],
  "creator": "0x04a3b2c1d0e0f0123456789abcdef",
  "royalties": {
    "ai_model_operator": "0x05b4c3d2e1f0a0b0c0d0e0f0234567",
    "platform_fee": "0x06c5d4e3f2a1b0c0d0e0f0345678"
  }
}
```

---

## 5. $SMAINER Token Economics

### Token Utility

| Use Case | Mechanism | Benefits |
|----------|-----------|----------|
| **Compute Payment** | Pay for AI inference with $SMAINER | Lower fees than $STRK, reward ecosystem users |
| **NFT Transactions** | Mint, buy, sell NFTs with $SMAINER | Create closed-loop economy |
| **On-chain Storage** | Pay for conversation/data storage | Persistent user experience |
| **Governance** | Vote on model additions, parameters | Decentralized platform decisions |
| **Staking Rewards** | Stake $SMAINER for compute credits | Incentivize token holding |

### Auto-Purchase Flow

```
User initiates action requiring $SMAINER
├─ Check balance sufficient?
├─ If no: Show "Purchase $SMAINER" modal
│   ├─ Swap $STRK → $SMAINER via DEX
│   ├─ Or buy with credit card via Ramp
│   └─ Auto-approve for platform use
└─ Execute original action seamlessly
```

---

## 6. On-Chain Database Implementation

### Storage Patterns

```cairo
// Conversation storage with user-controlled privacy
#[storage]
struct Storage {
    // conversation_id => encrypted_data_hash  
    conversations: Map<felt252, felt252>,
    
    // user_address => profile_data_hash
    user_profiles: Map<ContractAddress, felt252>,
    
    // nft_id => generation_metadata
    nft_metadata: Map<u256, GenerationMetadata>,
}

#[derive(Drop, Serde, starknet::Store)]
struct GenerationMetadata {
    prompt: felt252,
    model_used: felt252,
    provider_address: ContractAddress,
    generation_time: u64,
    quality_rating: u8,
}
```

### Privacy & Encryption

```
1. Client-side encryption of sensitive data
2. Store encrypted blobs on-chain or IPFS  
3. Users control their own encryption keys
4. Optional public sharing for social features
```

---

## 7. Implementation Roadmap

### Phase 1: Mini App Foundation (4-6 weeks)
- [ ] Next.js Mini App with Telegram Web App SDK
- [ ] Wallet connection (Telegram Wallet + ArgentX)
- [ ] Basic chat interface with existing bot backend
- [ ] $SMAINER token contract deployment

### Phase 2: NFT Integration (3-4 weeks)  
- [ ] Image generation via existing compute nodes
- [ ] NFT minting interface and contract
- [ ] IPFS integration for metadata storage
- [ ] Gallery view in Mini App

### Phase 3: On-chain Storage (2-3 weeks)
- [ ] User profile contract  
- [ ] Conversation persistence
- [ ] Privacy controls and encryption
- [ ] Data marketplace foundation

### Phase 4: Advanced Features (4-5 weeks)
- [ ] NFT marketplace with royalties
- [ ] Governance voting interface  
- [ ] Model performance analytics
- [ ] Social features and sharing

---

## 8. User Experience Comparison

| Feature | Current (CLI Bot) | Enhanced (Mini App) |
|---------|------------------|-------------------|
| **Wallet Setup** | `/link 0x04a3...` | One-click connect button |
| **Model Selection** | `/model llama3.1:8b` | Visual picker with GPU specs |
| **Payment** | Manage $STRK externally | Auto-purchase $SMAINER |
| **Content Creation** | Text only | Text + images + NFTs |
| **History** | Lost on restart | Persistent on-chain |
| **Social** | None | Share NFTs, rate models |
| **Discovery** | `/models` command | Rich model marketplace |
| **Earnings** | Node operators only | Users earn from NFT royalties |

This enhancement transforms Smainer from a technical CLI tool into a consumer-friendly Web3 creative platform while maintaining the decentralized compute foundation.