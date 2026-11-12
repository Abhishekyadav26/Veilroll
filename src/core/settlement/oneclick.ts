/**
 * The live 1Click adapter. Talks to our own /api/quote route (so the partner
 * JWT stays server-side) for quote/status, and never signs anything itself.
 *
 * Verified against https://docs.near-intents.org (Nov 2026):
 *   POST /v0/quote   { dry, swapType, slippageTolerance, originAsset, destinationAsset,
 *                      amount, recipient, recipientType, refundTo, refundType,
 *                      confidentiality: "public"|"basic"|"advanced", deadline }
 *   GET  /v0/status?depositAddress=...
 *   POST /v0/deposit/submit { depositAddress, txHash }   (optional, speeds up processing)
 */

import type { ChainVerification, Receipt } from "../types.ts";
import type {
  PaymentIntent,
  QuoteResult,
  SettlementProvider,
  SettlementStatus,
  SettlementState,
} from "./SettlementProvider.ts";

const QUOTE_TTL_MS = 3 * 60 * 1000; // quotes in 1Click expire quickly
const ONE_CLICK_STATUSES: SettlementState[] = [
  "PENDING_DEPOSIT",
  "KNOWN_DEPOSIT_TX",
  "INCOMPLETE_DEPOSIT",
  "PROCESSING",
  "SUCCESS",
  "REFUNDED",
  "FAILED",
];

export interface OneClickProviderOptions {
  /** Same-origin proxy that injects the JWT. */
  basePath?: string;
  /** Set true when the server has a partner JWT and can serve confidential quotes. */
  confidentialEnabled: boolean;
}

interface ServerQuoteResponse {
  ok: boolean;
  quote?: any;
  error?: string;
  code?: string;
  authRequired?: boolean;
}

export class OneClickProvider implements SettlementProvider {
  readonly kind = "oneclick" as const;
  readonly capabilities: { confidential: boolean; needsAuth: boolean; live: boolean };

  private basePath: string;

  constructor(opts: OneClickProviderOptions) {
    this.basePath = opts.basePath ?? "/api";
    this.capabilities = {
      confidential: opts.confidentialEnabled,
      needsAuth: !opts.confidentialEnabled,
      live: true,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.basePath}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as T;
    if (!res.ok) {
      const msg = (json as any)?.error || (json as any)?.message || `HTTP ${res.status}`;
      const err = new Error(msg) as Error & { code?: string; status?: number };
      err.code = (json as any)?.code;
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async quote(intent: PaymentIntent): Promise<QuoteResult> {
    const body = {
      dry: intent.dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: intent.originAsset,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: intent.destinationAsset,
      amount: intent.amountIn,
      recipient: intent.recipient,
      recipientType: "DESTINATION_CHAIN",
      refundTo: intent.refundTo,
      refundType: "ORIGIN_CHAIN",
      confidentiality: intent.confidentiality,
      deadline: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    };

    const res = await this.post<ServerQuoteResponse>("/quote", { paymentId: intent.id, body });
    if (!res.ok || !res.quote) {
      const err = new Error(res.error || "Quote failed") as Error & { code?: string };
      err.code = res.code;
      throw err;
    }

    const q = res.quote;
    const quote = q.quote ?? {};
    const qr = q.quoteRequest ?? {};

    return {
      paymentId: intent.id,
      depositAddress: quote.depositAddress,
      amountIn: quote.amountIn ?? intent.amountIn,
      amountOut: quote.amountOut ?? "0",
      minAmountOut: quote.minAmountOut ?? "0",
      amountInUsd: quote.amountInUsd,
      amountOutUsd: quote.amountOutUsd,
      timeEstimateSec: quote.timeEstimate ?? 0,
      correlationId: q.correlationId,
      quoteSignature: q.signature,
      snapshot: {
        amountIn: quote.amountIn ?? intent.amountIn,
        amountOut: quote.amountOut ?? "0",
        amountInUsd: quote.amountInUsd,
        amountOutUsd: quote.amountOutUsd,
        depositAddress: quote.depositAddress,
        timeEstimateSec: quote.timeEstimate,
        correlationId: q.correlationId,
        quoteSignature: q.signature,
        confidentiality: qr.confidentiality ?? intent.confidentiality,
        quotedAt: new Date().toISOString(),
      },
      raw: q,
    };
  }

  /**
   * The deposit itself is a wallet transaction, so `execute` only records the
   * broadcast result here: the caller passes the tx hash after the wallet signs.
   */
  async execute(intent: PaymentIntent, quote: QuoteResult): Promise<SettlementStatus> {
    if (!quote.depositAddress) {
      throw new Error("Quote has no deposit address (was this a dry quote?).");
    }
    return {
      paymentId: intent.id,
      state: "PENDING_DEPOSIT",
      updatedAt: new Date().toISOString(),
      raw: { awaitingDeposit: true, depositAddress: quote.depositAddress, dry: intent.dry },
    };
  }

  async status(paymentId: string, depositAddress?: string): Promise<SettlementStatus> {
    const addr = depositAddress ? `&depositAddress=${encodeURIComponent(depositAddress)}` : "";
    const res = await fetch(
      `${this.basePath}/status?paymentId=${encodeURIComponent(paymentId)}${addr}`,
      { cache: "no-store" },
    );
    const json = (await res.json()) as any;
    if (!res.ok || !json.ok) {
      throw new Error(json?.error || `Status failed (HTTP ${res.status})`);
    }
    return {
      paymentId,
      state: normalizeState(json.status),
      updatedAt: json.updatedAt ?? new Date().toISOString(),
      depositTxHash: json.swapDetails?.originChainTxHashes?.[0]?.hash,
      destinationTxHash: json.swapDetails?.destinationChainTxHashes?.[0]?.hash,
      explorerUrl: undefined,
      amountOut: json.swapDetails?.amountOut,
      raw: json,
    };
  }

  /**
   * Public re-check of settlement. Uses 1Click status (public, no key needed) and
   * compares the destination hash against the receipt. It does not pretend to be
   * a block-explorer balance check.
   */
  async verify(receipt: Receipt): Promise<ChainVerification> {
    const checkedAt = new Date().toISOString();
    if (!receipt.depositAddress) {
      return {
        verified: false,
        method: "none",
        checkedAt,
        note: "Receipt has no deposit address; nothing to look up.",
      };
    }
    try {
      const st = await this.status(receipt.paymentId, receipt.depositAddress);
      const matches =
        st.state === "SUCCESS" &&
        (!receipt.settlementReference || st.destinationTxHash === receipt.settlementReference);
      return {
        verified: matches,
        method: "1click-status",
        reference: st.destinationTxHash,
        checkedAt,
        note: matches
          ? "1Click reports SUCCESS with a matching destination transaction."
          : `1Click reports ${st.state}${st.destinationTxHash ? `, destination tx ${st.destinationTxHash}` : ""}.`,
      };
    } catch (e) {
      return {
        verified: false,
        method: "none",
        checkedAt,
        note: `Could not reach settlement status: ${(e as Error).message}`,
      };
    }
  }
}

function normalizeState(raw: string | undefined): SettlementState {
  const s = String(raw ?? "").toUpperCase();
  return (ONE_CLICK_STATUSES.find((x) => x === s) ?? "PENDING_DEPOSIT") as SettlementState;
}
