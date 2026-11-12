/**
 * Mock settlement provider.
 *
 * No network, no funds, no credentials. Deterministic behaviour so the demo and
 * the tests are reproducible. One scripted failure so per-payment retry and
 * failure states are visible, and verify() tells the truth (method: "none")
 * instead of pretending a chain was checked.
 */

import type { ChainVerification, Receipt } from "../types.ts";
import type {
  PaymentIntent,
  QuoteResult,
  SettlementProvider,
  SettlementStatus,
} from "./SettlementProvider.ts";
import { randomId } from "../crypto/bytes.ts";

interface MockState {
  quote?: QuoteResult;
  status?: SettlementStatus;
  polls: number;
  /** True once execute() has run; used to fail only the first attempt. */
  attempted?: boolean;
}

const now = () => new Date().toISOString();

/**
 * Scripted failure, so the per-payment failure + retry path is demoable.
 *
 * Rule (documented in the UI and README): a payment whose recipient address ends
 * in "0" fails, as does any payment id ending in "f" (used by the unit tests).
 * Everything else settles.
 */
function isScriptedFailure(paymentId: string, recipient?: string): boolean {
  if (paymentId.endsWith("f")) return true;
  if (recipient && recipient.trim().endsWith("0")) return true;
  return false;
}

export class MockSettlementProvider implements SettlementProvider {
  readonly kind = "mock" as const;
  readonly capabilities = { confidential: true, needsAuth: false, live: false } as const;

  private states = new Map<string, MockState>();

  private stateOf(paymentId: string): MockState {
    let s = this.states.get(paymentId);
    if (!s) {
      s = { polls: 0 };
      this.states.set(paymentId, s);
    }
    return s;
  }

  async quote(intent: PaymentIntent): Promise<QuoteResult> {
    // 1 mock unit of origin -> 0.996 units of destination, minus a small fee.
    const amountIn = BigInt(intent.amountIn || "0");
    const amountOut = (amountIn * 996n) / 1000n;
    const minAmountOut = (amountOut * 99n) / 100n;

    const quote: QuoteResult = {
      paymentId: intent.id,
      depositAddress: intent.dry ? undefined : `mock-deposit-${intent.id.slice(0, 8)}`,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      minAmountOut: minAmountOut.toString(),
      timeEstimateSec: 15,
      correlationId: `mock-${randomId()}`,
      quoteSignature: undefined,
      snapshot: {
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
        depositAddress: intent.dry ? undefined : `mock-deposit-${intent.id.slice(0, 8)}`,
        timeEstimateSec: 15,
        correlationId: `mock-${randomId()}`,
        confidentiality: intent.confidentiality,
        quotedAt: now(),
      },
      raw: { mock: true, dry: intent.dry, intent },
    };

    this.stateOf(intent.id).quote = quote;
    return quote;
  }

  async execute(intent: PaymentIntent, quote: QuoteResult): Promise<SettlementStatus> {
    if (intent.dry) {
      return {
        paymentId: intent.id,
        state: "PENDING_DEPOSIT",
        updatedAt: now(),
        raw: { mock: true, dry: true },
      };
    }
    // Fail the first attempt only, so the retry path visibly recovers.
    const st = this.stateOf(intent.id);
    const isFirstAttempt = !st.attempted;
    st.attempted = true;
    if (isFirstAttempt && isScriptedFailure(intent.id, intent.recipient)) {
      const status: SettlementStatus = {
        paymentId: intent.id,
        state: "FAILED",
        updatedAt: now(),
        raw: { mock: true, reason: "scripted failure (demo retry path)" },
      };
      this.stateOf(intent.id).status = status;
      return status;
    }
    // Fresh timeline for this attempt (a retry starts polling from zero).
    st.polls = 0;
    const status: SettlementStatus = {
      paymentId: intent.id,
      state: "PROCESSING",
      updatedAt: now(),
      depositTxHash: `mockDepositTx_${intent.id.slice(0, 8)}`,
      raw: { mock: true, quoted: quote.amountOut },
    };
    this.stateOf(intent.id).status = status;
    return status;
  }

  /**
   * Scripted timeline: PROCESSING (2 polls) -> SUCCESS.
   * Each call to status() advances the clock, which is what the UI polls.
   */
  async status(paymentId: string, _depositAddress?: string): Promise<SettlementStatus> {
    const s = this.stateOf(paymentId);
    const current = s.status;
    if (!current) {
      return { paymentId, state: "PENDING_DEPOSIT", updatedAt: now(), raw: { mock: true } };
    }
    if (current.state === "FAILED" || current.state === "REFUNDED") return current;

    s.polls += 1;
    if (s.polls <= 2) {
      s.status = { ...current, state: "PROCESSING", updatedAt: now() };
      return s.status;
    }

    const quote = s.quote;
    s.status = {
      ...current,
      state: "SUCCESS",
      updatedAt: now(),
      destinationTxHash: `0xmock${paymentId.slice(0, 12).replace(/-/g, "")}`,
      explorerUrl: undefined, // mock has no real explorer
      amountOut: quote?.amountOut,
      raw: { mock: true, settled: true },
    };
    return s.status;
  }

  /** Mock mode has no chain to check. Say so explicitly. */
  async verify(receipt: Receipt): Promise<ChainVerification> {
    return {
      verified: receipt.status === "settled",
      method: "none",
      reference: receipt.settlementReference,
      checkedAt: now(),
      note: "Mock mode: there is no on-chain settlement to check. This confirms the receipt is internally consistent only.",
    };
  }

  /** Test/demo helper: force a state. */
  _force(paymentId: string, status: SettlementStatus): void {
    this.stateOf(paymentId).status = status;
  }
}
