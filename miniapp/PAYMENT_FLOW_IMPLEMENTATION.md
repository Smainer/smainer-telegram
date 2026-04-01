# STRK Payment Flow Implementation Summary

## Files Created/Updated

### 1. `/src/lib/starknet.ts` - Updated contract configuration
**Added:**
- `SMAINER_COMPUTE` contract address: `0x044bf558b2e5ba7b3b24a18ff4944833ef9526b47907bcbdcbf94c33f4431abe`
- `STRK_TOKEN` address: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`
- `SMAINER_COMPUTE_ABI` with `create_task`, `create_tiered_task`, `get_tier_multiplier`
- `ERC20_ABI` with `balance_of`, `transfer`, `approve`, `allowance`
- Tier configuration: BASIC (1x), PRO (2.2x), PREMIUM (3.5x)
- `BASE_PROMPT_COST`: 0.1 STRK in wei
- `getPromptCost()` function for tier-based pricing
- `hashPrompt()` function for felt252 conversion

### 2. `/src/hooks/useSmainerContract.ts` - New contract interaction hook
**Features:**
- `createTask(prompt, tier)` - Handles approve + create_tiered_task multicall
- `checkAllowance()` - Verifies current STRK allowance
- `checkBalance()` - Gets user's STRK balance  
- `getPromptCostForTier()` - Returns formatted cost for UI
- Loading/error state management
- Uses `useAccount` and `useContract` from starknet-react

### 3. `/src/components/PaymentFlow.tsx` - New payment UI component
**Features:**
- Tier selection and cost breakdown
- Balance verification with insufficient balance warnings
- Multi-step flow: confirm → processing → success/error
- Integration with existing dark theme (#0D0D0F, #00D4AA)
- Mobile-first responsive design
- Error handling with retry functionality

### 4. `/src/components/ChatInterface.tsx` - Updated chat flow
**Changes:**
- Added payment flow integration before task submission
- New state: `showPaymentFlow`, `pendingPrompt`, `selectedTier`
- `handleSubmit()` now shows payment modal instead of direct submission
- `handlePaymentSuccess()` processes payment → sends to relayer
- Added payment confirmation step in message history
- Updated interface props to accept optional `onChainTaskId`

### 5. `/src/hooks/useRelayerAPI.ts` - Updated API client
**Changes:**
- `submitInferenceTask()` now accepts optional `onChainTaskId` parameter
- Adds `on_chain_task_id` to request payload for relayer verification

### 6. `/src/App.tsx` - Updated integration
**Changes:**
- `handleSubmitInferenceTask()` now passes `onChainTaskId` to relayer API

## Payment Flow Sequence

1. **User enters prompt** → Shows payment confirmation modal
2. **Payment modal** → Displays cost, tier, balance verification
3. **User approves** → Triggers `createTask()` with multicall:
   - `approve(SMAINER_COMPUTE, amount)` if needed
   - `create_tiered_task(STRK_TOKEN, amount, tier, promptHash)`
4. **Transaction confirmed** → Returns on-chain `task_id`
5. **Submit to relayer** → Includes `on_chain_task_id` in API call
6. **Relayer processes** → Verifies payment before assignment

## Current Entry Points

- Production entry: bot MiniApp button → `/?action=pay`
- Wallet resume entry: `/pay-resume`
- Removed from production: `/connect`, `?mode=connect`, and static `connect.html`

## Cost Structure

- **Base cost**: 0.1 STRK per prompt
- **BASIC tier**: 0.1 STRK (1.0x multiplier)  
- **PRO tier**: 0.22 STRK (2.2x multiplier)
- **PREMIUM tier**: 0.35 STRK (3.5x multiplier)

## Technical Notes

- Uses Web Crypto API for prompt hashing (SHA-256 → felt252)
- Multicall optimization: approve + create_task in single transaction
- Error recovery: handles wallet rejects, insufficient balance, network failures
- Loading states with proper UI feedback throughout flow
- Respects existing MiniApp design system and component patterns

## Testing

The implementation follows existing patterns and should integrate seamlessly with:
- Existing wallet connection inside `PaymentFlow` (Argent X/Braavos)
- Current relayer API integration  
- Telegram WebApp environment
- Mobile-responsive design requirements

## Next Steps

1. Test payment flow in development environment
2. Verify contract ABI matches deployed contract
3. Implement proper task_id extraction from transaction events
4. Add error analytics for payment failures
5. Consider adding payment confirmation receipts