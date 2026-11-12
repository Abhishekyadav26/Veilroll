/**
 * The settlement interface. Mock and live (1Click) implementations satisfy it,
 * so every screen works without funds or credentials.
 */

import type {
  ChainVerification,
  Confidentiality,
  QuoteSnapshot,
  Receipt,
  SettlementState,
  TokenAmount,
} from "../types.ts";

export type { SettlementState };

export interface PaymentIntent {
  /** Stable payment id; reused across retries so a receipt stays attached. */
  id: string;
  originAsset: string;
  destinationAsset: string;
  /** Amount of originAsset to spend, in that asset's smallest unit. */
  amountIn: TokenAmount;
  recipient: string;
  refundTo: string;
  confidentiality: Confidentiality;
  /** true → ask for a quote only, never move funds. */
  dry: boolean;
}

export interface QuoteResult {
  paymentId: string;
  /** Absent on dry quotes (documented 1Click behaviour). */
  depositAddress?: string;
  amountIn: TokenAmount;
  amountOut: TokenAmount;
  minAmountOut: TokenAmount;
  amountInUsd?: string;
  amountOutUsd?: string;
  timeEstimateSec: number;
  correlationId?: string;
  quoteSignature?: string;
  snapshot: QuoteSnapshot;
  /** Full provider payload, kept in the receipt for auditing. */
  raw: unknown;
}

export interface SettlementStatus {
  paymentId: string;
  state: SettlementState;
  updatedAt: string;
  depositTxHash?: string;
  destinationTxHash?: string;
  explorerUrl?: string;
  amountOut?: TokenAmount;
  raw: unknown;
}

export interface SettlementCapabilities {
  /** True when the provider can request `confidentiality: basic|advanced` for real. */
  confidential: boolean;
  /** True when quotes/execution no longer need credentials. */
  needsAuth: boolean;
  /** True when this provider touches a real network at all. */
  live: boolean;
}

export interface SettlementProvider {
  readonly kind: "mock" | "oneclick";
  readonly capabilities: SettlementCapabilities;

  /** Request a quote. Mock never hits the network. */
  quote(intent: PaymentIntent): Promise<QuoteResult>;

  /**
   * Execute an approved intent. For live providers this is only called after
   * the wallet has signed the deposit; it never signs on its own.
   */
  execute(intent: PaymentIntent, quote: QuoteResult): Promise<SettlementStatus>;

  status(paymentId: string, depositAddress?: string): Promise<SettlementStatus>;

  /** Independent, public re-check of a settled payment (auditor side). */
  verify(receipt: Receipt): Promise<ChainVerification>;
}
