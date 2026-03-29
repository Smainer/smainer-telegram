import type { AccountInterface } from 'starknet';
import { hash, RpcProvider } from 'starknet';
import { CONTRACT_ADDRESSES, hashPrompt } from '@/lib/starknet';
import {
  AbstractPaymentStrategy,
  type ProgressCallback,
} from './AbstractPaymentStrategy';
import type {
  PaymentContext,
  PaymentResult,
  StrategyCapabilities,
} from '../types';

// -------------------------------------------------------------------------
// Private helpers
// -------------------------------------------------------------------------

/** Splits a bigint into U256 Cairo calldata: [low_felt, high_felt] */
function toU256Calldata(value: bigint): [string, string] {
  const mask = (BigInt(1) << BigInt(128)) - BigInt(1);
  const low = (value & mask).toString();
  const high = (value >> BigInt(128)).toString();
  return [low, high];
}

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------
const RPC_URL = 'https://api.cartridge.gg/x/starknet/mainnet';
const GAS_BUFFER = BigInt('10000000000000000'); // 0.01 STRK
const EXECUTE_TIMEOUT_MS = 90_000;  // 90 s — wallet must respond within this
const POLL_INTERVAL_MS = 4_000;
const MAX_WAIT_MS = 120_000;       // 2 min receipt poll

// -------------------------------------------------------------------------
// Strategy
// -------------------------------------------------------------------------

export class StarknetWalletStrategy extends AbstractPaymentStrategy {
  private account: AccountInterface;
  private checkAllowance: () => Promise<bigint>;

  constructor(
    account: AccountInterface,
    checkAllowance: () => Promise<bigint>,
    onProgress: ProgressCallback,
  ) {
    super(onProgress);
    this.account = account;
    this.checkAllowance = checkAllowance;
  }

  getCapabilities(): StrategyCapabilities {
    return {
      canSign: true,
      requiresRedirect: false,
      ctaLabel: 'Approve & Pay',
    };
  }

  async execute(ctx: PaymentContext): Promise<PaymentResult> {
    try {
      // ----------------------------------------------------------------
      // Phase 1 — check current allowance
      // ----------------------------------------------------------------
      this.onProgress({ phase: 'checking-allowance' });

      const currentAllowance = await this.checkAllowance();
      const needsApproval = currentAllowance < ctx.escrowAmountWei;

      // ----------------------------------------------------------------
      // Phase 2 — build multicall
      // ----------------------------------------------------------------
      this.onProgress({ phase: 'awaiting-wallet-approval' });

      const promptHash = await hashPrompt(ctx.prompt);

      const calls: { contractAddress: string; entrypoint: string; calldata: string[] }[] = [];

      if (needsApproval) {
        const approveAmount = ctx.escrowAmountWei + GAS_BUFFER;
        calls.push({
          contractAddress: CONTRACT_ADDRESSES.STRK_TOKEN,
          entrypoint: 'approve',
          calldata: [CONTRACT_ADDRESSES.SMAINER_COMPUTE, ...toU256Calldata(approveAmount)],
        });
      }

      const tierCalldata =
        ctx.tier === 'BASIC' ? '1' : ctx.tier === 'PRO' ? '2' : '3';

      calls.push({
        contractAddress: CONTRACT_ADDRESSES.SMAINER_COMPUTE,
        entrypoint: 'create_tiered_task',
        calldata: [
          CONTRACT_ADDRESSES.STRK_TOKEN,          // token_address
          ...toU256Calldata(ctx.escrowAmountWei),  // base_amount (u256: low, high)
          tierCalldata,                            // required_tier
          promptHash,                              // task_hash
        ],
      });

      // ----------------------------------------------------------------
      // Phase 3 — execute multicall with hard timeout
      // ----------------------------------------------------------------
      this.onProgress({ phase: 'broadcasting' });

      const executeWithTimeout = (): Promise<{ transaction_hash: string }> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              reject(
                new Error(
                  'Wallet did not respond after 90 seconds. ' +
                  'The wallet popup may have been blocked, or the transaction simulation failed silently. ' +
                  'Please try again.',
                ),
              ),
            EXECUTE_TIMEOUT_MS,
          );
          this.account
            .execute(calls)
            .then((r) => {
              clearTimeout(timer);
              resolve(r as { transaction_hash: string });
            })
            .catch((e) => {
              clearTimeout(timer);
              reject(e);
            });
        });

      const execResult = await executeWithTimeout();

      if (!execResult.transaction_hash) {
        throw new Error('Transaction failed — no hash returned');
      }

      const txHash = execResult.transaction_hash;

      // ----------------------------------------------------------------
      // Phase 4 — poll for receipt
      // ----------------------------------------------------------------
      this.onProgress({ phase: 'confirming', txHash });

      const rpcProvider = new RpcProvider({ nodeUrl: RPC_URL });

      const receiptPromise = rpcProvider.waitForTransaction(txHash, {
        retryInterval: POLL_INTERVAL_MS,
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('Transaction confirmation timed out after 2 minutes')),
          MAX_WAIT_MS,
        ),
      );
      const receipt = await Promise.race([receiptPromise, timeoutPromise]);

      // ----------------------------------------------------------------
      // Phase 5 — parse task id from TaskCreated event
      // ----------------------------------------------------------------
      let taskId: string;
      try {
        const taskCreatedSelector = hash.getSelectorFromName('TaskCreated');

        const taskCreatedEvent = receipt.events?.find(
          (event) =>
            event.from_address === CONTRACT_ADDRESSES.SMAINER_COMPUTE &&
            event.keys[0] === taskCreatedSelector,
        );

        if (taskCreatedEvent && taskCreatedEvent.keys.length >= 3) {
          // task_id (u256) split: keys[1] = low, keys[2] = high
          const taskIdLow = BigInt(taskCreatedEvent.keys[1]);
          const taskIdHigh = BigInt(taskCreatedEvent.keys[2]);
          const U128_MAX_PLUS_ONE = BigInt('340282366920938463463374607431768211456'); // 2^128
          const fullTaskId = taskIdHigh * U128_MAX_PLUS_ONE + taskIdLow;
          taskId = fullTaskId.toString();
        } else {
          // Fallback: call task_count entrypoint (latest task id)
          console.warn('[StarknetWalletStrategy] TaskCreated event not found, using task_count fallback');
          const fallbackResult = await rpcProvider.callContract({
            contractAddress: CONTRACT_ADDRESSES.SMAINER_COMPUTE,
            entrypoint: 'task_count',
            calldata: [],
          }, 'latest');
          const raw = (fallbackResult as any).result ?? fallbackResult;
          taskId = BigInt((raw as string[])[0]).toString();
        }
      } catch (parseErr) {
        console.error('[StarknetWalletStrategy] Failed to parse task_id:', parseErr);
        // Last-resort fallback
        const fallbackResult = await rpcProvider.callContract({
          contractAddress: CONTRACT_ADDRESSES.SMAINER_COMPUTE,
          entrypoint: 'task_count',
          calldata: [],
        }, 'latest');
        const raw = (fallbackResult as any).result ?? fallbackResult;
        taskId = BigInt((raw as string[])[0]).toString();
      }

      // ----------------------------------------------------------------
      // Phase 6 — notify bot
      // ----------------------------------------------------------------
      await this.notifyBot(ctx, taskId, txHash);

      this.onProgress({ phase: 'done', txHash, taskId });

      return { success: true, taskId, txHash };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      this.onProgress({ phase: 'error', errorMessage });
      return { success: false, errorMessage };
    }
  }
}
