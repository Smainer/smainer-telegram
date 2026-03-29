import { useMemo } from 'react';
import {
  BASE_PROMPT_COST,
  COMPUTE_TIERS,
  ComputeTier,
  TOKEN_DECIMALS,
  formatTokenAmount,
  estimateTokenCount,
  getModelComplexity,
  MAX_EFFORT_MULTIPLIER,
  SAFETY_MARGIN,
} from '../lib/starknet';

export interface CostEstimate {
  inputTokens: number;
  estimatedEffort: number;
  maxEscrow: string;
  maxEscrowWei: bigint;
  estimatedActual: string;
  tierMultiplier: number;
  modelComplexity: number;
}

export function useCostEstimate(
  prompt: string,
  tier: ComputeTier,
  modelId: string,
): CostEstimate {
  return useMemo(() => {
    const inputTokens = estimateTokenCount(prompt);
    const maxOutputTokens = 512;
    const modelComplexity = getModelComplexity(modelId);

    const effort = Math.min(MAX_EFFORT_MULTIPLIER, Math.max(1.0,
      (inputTokens / 100) * 0.3
      + (maxOutputTokens / 256) * 0.5
      + modelComplexity
    ));

    const tierMult = COMPUTE_TIERS[tier].multiplier;

    const maxEscrowWei = BigInt(
      Math.floor(Number(BASE_PROMPT_COST) * tierMult * effort * SAFETY_MARGIN)
    );
    const estimatedActualWei = BigInt(
      Math.floor(Number(BASE_PROMPT_COST) * tierMult * effort)
    );

    return {
      inputTokens,
      estimatedEffort: effort,
      maxEscrow: formatTokenAmount(maxEscrowWei, TOKEN_DECIMALS.STRK),
      maxEscrowWei,
      estimatedActual: formatTokenAmount(estimatedActualWei, TOKEN_DECIMALS.STRK),
      tierMultiplier: tierMult,
      modelComplexity,
    };
  }, [prompt, tier, modelId]);
}
