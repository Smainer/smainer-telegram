import { useState, useCallback } from 'react';
import { useAccount, useContract } from '@starknet-react/core';
import { hash, RpcProvider } from 'starknet';
import { 
  CONTRACT_ADDRESSES,
  SMAINER_COMPUTE_ABI,
  ERC20_ABI,
  ComputeTier,
  getPromptCost,
  hashPrompt,
  formatTokenAmount,
  TOKEN_DECIMALS
} from '@/lib/starknet';

function toU256Calldata(value: bigint): [string, string] {
  const mask = (BigInt(1) << BigInt(128)) - BigInt(1);
  const low = (value & mask).toString();
  const high = (value >> BigInt(128)).toString();
  return [low, high];
}

interface ContractTxState {
  loading: boolean;
  error: string | null;
  txHash?: string;
}

interface CreateTaskResult {
  success: boolean;
  taskId?: string;
  txHash?: string;
  error?: string;
}

export function useSmainerContract() {
  const { address, account } = useAccount();
  const [txState, setTxState] = useState<ContractTxState>({
    loading: false,
    error: null
  });

  // Contract instances
  const { contract: smainerContract } = useContract({
    address: CONTRACT_ADDRESSES.SMAINER_COMPUTE,
    abi: SMAINER_COMPUTE_ABI,
  });

  const { contract: strkContract } = useContract({
    address: CONTRACT_ADDRESSES.STRK_TOKEN,
    abi: ERC20_ABI,
  });

  // Check current STRK allowance for the compute contract (raw RPC to bypass ABI wrapper issues)
  const checkAllowance = useCallback(async (): Promise<bigint> => {
    if (!address) {
      throw new Error('Wallet not connected');
    }

    try {
      const hexPart = address.toLowerCase().replace(/^0x/, '');
      const normalizedOwner = '0x' + hexPart.padStart(64, '0');
      const spenderHex = CONTRACT_ADDRESSES.SMAINER_COMPUTE.toLowerCase().replace(/^0x/, '');
      const normalizedSpender = '0x' + spenderHex.padStart(64, '0');

      const provider = new RpcProvider({
        nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet'
      });

      const result = await provider.callContract({
        contractAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
        entrypoint: 'allowance',
        calldata: [normalizedOwner, normalizedSpender],
      }, 'latest');

      const rawResult = (result as any).result ?? result;
      const resultArray = rawResult as string[];
      const U128_MAX_PLUS_ONE = BigInt('340282366920938463463374607431768211456'); // 2^128
      const low = BigInt(resultArray[0]);
      const high = resultArray[1] ? BigInt(resultArray[1]) : BigInt(0);
      return high * U128_MAX_PLUS_ONE + low;
    } catch (error) {
      console.error('Failed to check allowance:', error);
      throw new Error('Failed to check allowance');
    }
  }, [address]);

  // Check STRK balance using raw RPC (bypasses starknet-react contract wrapper issues)
  const checkBalance = useCallback(async (targetAddress?: string): Promise<string> => {
    const addr = targetAddress || address;
    if (!addr) {
      console.log('[checkBalance] Not ready - no address');
      throw new Error('Wallet not connected');
    }

    try {
      // Normalize address to 64 hex chars (matching bot's format)
      // Wallet extensions may return short-form addresses
      const hexPart = addr.toLowerCase().replace(/^0x/, '');
      const normalizedAddress = '0x' + hexPart.padStart(64, '0');

      console.log('[checkBalance] Using raw RPC for address:', normalizedAddress);
      console.log('[checkBalance] STRK contract address:', CONTRACT_ADDRESSES.STRK_TOKEN);
      
      // Use raw RpcProvider to bypass ABI type validation issues
      const provider = new RpcProvider({ 
        nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet' 
      });
      
      // Call balance_of directly via callContract
      // IMPORTANT: Use positional array, not named object - CallData.compile({ name: val })
      // only works with an ABI parameter, otherwise it produces malformed calldata
      const result = await provider.callContract({
        contractAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
        entrypoint: 'balance_of',
        calldata: [normalizedAddress],
      }, 'latest');
      
      console.log('[checkBalance] Raw RPC result:', result);

      // starknet.js v5 callContract returns { result: string[] }
      // Extract the inner array
      const U128_MAX_PLUS_ONE = BigInt('340282366920938463463374607431768211456'); // 2^128
      const rawResult = (result as any).result ?? result;
      const resultArray = rawResult as string[];
      const low = BigInt(resultArray[0]);
      const high = resultArray[1] ? BigInt(resultArray[1]) : BigInt(0);
      const balance = high * U128_MAX_PLUS_ONE + low;
      
      console.log('[checkBalance] Parsed u256:', { 
        low: low.toString(), 
        high: high.toString(), 
        balance: balance.toString() 
      });
      
      // Format to human-readable
      const formatted = formatTokenAmount(balance, TOKEN_DECIMALS.STRK);
      console.log('[checkBalance] Final:', formatted, 'STRK');
      return formatted;
    } catch (error) {
      console.error('[checkBalance] Failed:', error);
      throw new Error(`Failed to check balance: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [address]); // address is the fallback; targetAddress takes priority when provided

  // Get prompt cost for a specific tier
  const getPromptCostForTier = useCallback((tier: ComputeTier): string => {
    const costWei = getPromptCost(tier);
    return formatTokenAmount(costWei.toString(), TOKEN_DECIMALS.STRK);
  }, []);

  // Create a task with on-chain payment
  const createTask = useCallback(async (
    prompt: string,
    tier: ComputeTier = 'BASIC',
    _targetAddress?: string,
    escrowAmount?: bigint
  ): Promise<CreateTaskResult> => {
    if (!account || !smainerContract || !strkContract) {
      throw new Error('Wallet not connected or contracts not available');
    }

    setTxState({ loading: true, error: null });

    try {
      // Use caller-provided dynamic escrow amount, or fall back to flat tier cost
      const promptCost = escrowAmount ?? getPromptCost(tier);
      const promptHash = await hashPrompt(prompt);
      
      // Check if we need to approve more tokens
      const currentAllowance = await checkAllowance();
      const needsApproval = currentAllowance < promptCost;

      // Prepare multicall transactions
      const calls: { contractAddress: string; entrypoint: string; calldata: string[] }[] = [];

      // Add approval if needed
      if (needsApproval) {
        // Approve for this specific amount + small buffer for gas
        const approveAmount = promptCost + BigInt('10000000000000000'); // +0.01 STRK buffer
        calls.push({
          contractAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
          entrypoint: 'approve',
          calldata: [CONTRACT_ADDRESSES.SMAINER_COMPUTE, ...toU256Calldata(approveAmount)],
        });
      }

      // Add create_tiered_task call
      calls.push({
        contractAddress: CONTRACT_ADDRESSES.SMAINER_COMPUTE,
        entrypoint: 'create_tiered_task',
        calldata: [
          CONTRACT_ADDRESSES.STRK_TOKEN,                         // token_address
          ...toU256Calldata(promptCost),                         // base_amount (u256: low, high)
          tier === 'BASIC' ? '1' : tier === 'PRO' ? '2' : '3', // required_tier
          promptHash                                             // task_hash
        ],
      });

      // Execute multicall.
      // IMPORTANT: account.execute() is the wallet extension's own method.
      // Some wallet versions hang indefinitely if the internal fee-estimation
      // simulation reverts (e.g. stale allowance state, bad calldata, RPC
      // error on the wallet's own node).  Wrap the call in a hard timeout so
      // the spinner never freezes permanently.
      const EXECUTE_TIMEOUT_MS = 90_000;  // 90 s – wallet should respond well within this
      const POLL_INTERVAL_MS   = 4_000;
      const MAX_WAIT_MS        = 120_000; // 2 min receipt poll

      const executeWithTimeout = () =>
        new Promise<{ transaction_hash: string }>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(
              'Wallet did not respond after 90 seconds. ' +
              'The wallet popup may have been blocked, or the transaction simulation failed silently. ' +
              'Please try again.'
            )),
            EXECUTE_TIMEOUT_MS
          );
          account.execute(calls)
            .then((r) => { clearTimeout(timer); resolve(r as { transaction_hash: string }); })
            .catch((e) => { clearTimeout(timer); reject(e); });
        });

      const result = await executeWithTimeout();

      if (!result.transaction_hash) {
        throw new Error('Transaction failed - no hash returned');
      }

      // Wait for transaction confirmation using a standalone RpcProvider instead
      // of account.waitForTransaction.  The wallet extension account object may
      // not implement waitForTransaction, and even when it does it uses the
      // wallet's own RPC node which can differ from ours.  Using our own
      // provider gives us full control over the polling loop and timeout.
      const rpcProvider = new RpcProvider({
        nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet',
      });

      const receiptPromise = rpcProvider.waitForTransaction(result.transaction_hash, {
        retryInterval: POLL_INTERVAL_MS,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Transaction confirmation timed out after 2 minutes')),
          MAX_WAIT_MS
        )
      );
      const receipt = await Promise.race([receiptPromise, timeoutPromise]);

      // Extract task_id from transaction receipt
      let taskId: string;
      try {
        // Get TaskCreated event selector
        const taskCreatedSelector = hash.getSelectorFromName('TaskCreated');
        
        // Find the TaskCreated event from our contract
        const taskCreatedEvent = receipt.events?.find(event => 
          event.from_address === CONTRACT_ADDRESSES.SMAINER_COMPUTE &&
          event.keys[0] === taskCreatedSelector
        );

        if (taskCreatedEvent && taskCreatedEvent.keys.length >= 3) {
          // TaskCreated event has task_id as first keyed field (after selector)
          // task_id (u256) is split into low (keys[1]) and high (keys[2]) parts
          const taskIdLow = BigInt(taskCreatedEvent.keys[1]);
          const taskIdHigh = BigInt(taskCreatedEvent.keys[2]);
          const fullTaskId = taskIdHigh * (BigInt(2) ** BigInt(128)) + taskIdLow;
          taskId = fullTaskId.toString();
        } else {
          // Fallback: read task_count from contract (should be latest task_id)
          console.warn('Could not parse TaskCreated event, using fallback method');
          const taskCountResult = await smainerContract.call('task_count');
          taskId = (taskCountResult as bigint).toString();
        }
      } catch (error) {
        console.error('Failed to parse task_id from events:', error);
        // Last resort fallback
        const taskCountResult = await smainerContract.call('task_count');
        taskId = (taskCountResult as bigint).toString();
      }

      setTxState({ loading: false, error: null, txHash: result.transaction_hash });

      return {
        success: true,
        taskId,
        txHash: result.transaction_hash
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setTxState({ loading: false, error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }, [account, smainerContract, strkContract, checkAllowance]);

  // Reset transaction state
  const resetTxState = useCallback(() => {
    setTxState({ loading: false, error: null });
  }, []);

  return {
    // Contract interactions
    createTask,
    checkAllowance,
    checkBalance,
    getPromptCostForTier,
    
    // Transaction state
    isLoading: txState.loading,
    error: txState.error,
    txHash: txState.txHash,
    resetTxState,
    
    // Contract availability (address not required — callers pass it where needed)
    isContractReady: !!(smainerContract && strkContract),
  };
}