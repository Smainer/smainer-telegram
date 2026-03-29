// Types
export type {
  PaymentEnvironment,
  PaymentPhase,
  PaymentContext,
  PaymentProgress,
  PaymentResult,
  StrategyCapabilities,
  BotNotificationPayload,
} from './types';

// Abstract base
export { AbstractPaymentStrategy } from './strategies/AbstractPaymentStrategy';
export type { ProgressCallback } from './strategies/AbstractPaymentStrategy';

// Concrete strategies
export { StarknetWalletStrategy } from './strategies/StarknetWalletStrategy';
export { TelegramWebViewStrategy } from './strategies/TelegramWebViewStrategy';
export { BotLinkedStrategy } from './strategies/BotLinkedStrategy';

// Factory
export {
  resolveEnvironment,
  createPaymentStrategy,
} from './factory';
export type { ResolveEnvironmentInput, CreateStrategyInput } from './factory';
