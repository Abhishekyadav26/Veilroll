/**
 * Receipt lifecycle: build from a settled payment, encrypt with the per-run key,
 * and decrypt on the auditor side.
 */

import type { Payment, PayrollRun, Receipt } from "./types.ts";
import { openGcm, sealGcm } from "./crypto/aes.ts";

/** Build a receipt from a payment. Pure — no crypto, easy to test. */
export function buildReceipt(run: PayrollRun, payment: Payment): Receipt {
  const { settlement } = payment;
  return {
    paymentId: payment.id,
    runId: run.id,
    recipient: payment.recipient,
    assetId: payment.assetId,
    symbol: payment.symbol ?? symbolOf(payment.assetId),
    decimals: payment.decimals,
    amount: settlement?.amountOut ?? payment.amount,
    amountUsd: settlement?.quote?.amountOutUsd,
    chain: payment.chain,
    status: payment.status,
    confidentiality: payment.confidentiality,
    date: payment.createdAt,
    settledAt: settlement?.settledAt ?? (payment.status === "settled" ? settlement?.settledAt : undefined),
    settlementReference: settlement?.destinationTxHash,
    explorerUrl: settlement?.explorerUrl,
    depositAddress: settlement?.quote?.depositAddress,
    quoteSignature: settlement?.quote?.quoteSignature,
    correlationId: settlement?.quote?.correlationId,
  };
}

/**
 * Fallback display symbol for an assetId when no token registry is loaded.
 * Unknown ids are truncated for display rather than mislabelled.
 */
export function symbolOf(assetId: string): string {
  const lower = assetId.toLowerCase();
  if (lower.includes("17208628f84f5d6ad33f0da3bbbeb27ffcb398ea")) return "USDC";
  if (lower.includes("af88d065e77c8cc2239327c5edb3a432268e5831")) return "USDC";
  if (lower.includes("a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")) return "USDC";
  if (lower.includes("833589fcd6edb6e08f4c7c32d4f71b54bda02913")) return "USDC";
  if (lower.includes("dac17f958d2ee523a2206206994597c13d831ec7")) return "USDT";
  if (lower.includes("usdt.tether-token.near")) return "USDT";
  if (lower.includes("wrap.near")) return "wNEAR";
  if (lower.includes("btc")) return "BTC";
  if (lower.includes("sol.omft")) return "SOL";
  if (lower.includes("eth.omft") || lower.includes("eth.bridge")) return "ETH";
  const bare = assetId.replace(/^nep141:/, "");
  return bare.length > 10 ? `${bare.slice(0, 8)}…` : bare || "TOKEN";
}

export interface DecryptedReceipts {
  receipts: Receipt[];
  runId: string;
  employer: string;
  name: string;
}

/** Encrypt a receipt list for storage. */
export async function encryptReceipts(receipts: Receipt[], runKey: CryptoKey): Promise<{ data: string; iv: string }> {
  return sealGcm({ receipts }, runKey);
}

/** Decrypt with an unwrapped run key. Throws if the key is wrong (AES-GCM auth). */
export async function decryptReceipts(
  sealed: { data: string; iv: string },
  runKey: CryptoKey,
): Promise<Receipt[]> {
  const out = await openGcm<{ receipts: Receipt[] }>(sealed, runKey);
  if (!Array.isArray(out.receipts)) throw new Error("Malformed receipt payload");
  return out.receipts;
}
