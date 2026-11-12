/**
 * Domain types for Veilroll.
 *
 * A "run" is one payroll batch. A "payment" is one recipient/amount/asset/chain
 * within it. Every payment produces a "receipt". An "auditor share" is a scoped
 * view (one payment, a date range, or a whole run) that decrypts only the
 * receipts the employer selected.
 *
 * Everything here is JSON-safe: bigint values are stored as decimal strings and
 * only converted to `bigint` at the edges (quote/display).
 */

// ---------------------------------------------------------------------------
// Money / assets
// ---------------------------------------------------------------------------

/** A supported asset as exposed by the 1Click tokens endpoint. */
export interface Asset {
  assetId: string; // e.g. "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
  decimals: number;
  blockchain: string; // near | eth | arb | base | sol | btc | tron | ...
  symbol: string;
  price?: number;
  contractAddress?: string | null;
}

/** A monetary value in the asset's smallest unit, kept as a decimal string. */
export type TokenAmount = string;

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

export type Confidentiality = "public" | "basic" | "advanced";

/** Terminal and intermediate settlement states reported by 1Click. */
export type SettlementState =
  | "PENDING_DEPOSIT"
  | "KNOWN_DEPOSIT_TX"
  | "INCOMPLETE_DEPOSIT"
  | "PROCESSING"
  | "SUCCESS"
  | "REFUNDED"
  | "FAILED";

export type PaymentStatus =
  | "draft" // composed, not yet quoted
  | "quoted" // quote obtained (dry or live), not yet executed
  | "signing" // wallet approval in progress
  | "submitted" // deposit tx broadcast; waiting to settle
  | "settled" // confirmed received on destination chain
  | "failed" // failed / refunded; retry is allowed
  | "retry"; // user re-submitted the same intent

export interface Payment {
  id: string; // uuid — stable across retries
  recipient: string; // destination-chain address
  assetId: string; // 1Click destination assetId
  symbol?: string; // display symbol, from the token registry when available
  amount: TokenAmount; // in destination asset smallest unit
  decimals: number; // destination asset decimals, for display
  chain: string; // destination blockchain, e.g. "arb"
  status: PaymentStatus;
  confidentiality: Confidentiality;
  createdAt: string; // ISO
  lastError?: string;
  settlement?: SettlementInfo;
}

/** What happened between quote and confirmed settlement. */
export interface SettlementInfo {
  quote?: QuoteSnapshot;
  depositTxHash?: string;
  state?: string; // 1Click status string, e.g. "SUCCESS"
  destinationTxHash?: string; // the settlement reference on the destination chain
  explorerUrl?: string; // public link to destinationTxHash
  settledAt?: string;
  amountOut?: TokenAmount;
}

/** Frozen quote fields kept in the receipt. */
export interface QuoteSnapshot {
  amountIn: TokenAmount;
  amountOut: TokenAmount;
  amountInUsd?: string;
  amountOutUsd?: string;
  depositAddress?: string;
  timeEstimateSec?: number;
  correlationId?: string;
  quoteSignature?: string; // 1Click quote signature, saved per docs for disputes
  confidentiality: Confidentiality;
  quotedAt: string;
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export interface Receipt {
  paymentId: string;
  runId: string;
  recipient: string;
  assetId: string;
  symbol: string;
  decimals: number; // destination asset decimals, so display never guesses
  amount: TokenAmount; // destination asset, smallest unit
  amountUsd?: string;
  chain: string;
  status: PaymentStatus;
  confidentiality: Confidentiality;
  date: string; // ISO (creation of the payment)
  settledAt?: string;
  settlementReference?: string; // destinationTxHash — the public on-chain proof
  explorerUrl?: string;
  depositAddress?: string;
  quoteSignature?: string;
  correlationId?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export interface PayrollRun {
  id: string;
  employer: string; // NEAR accountId
  name: string;
  createdAt: string; // ISO
  currency: string; // display currency code, e.g. "USD"
  payments: Payment[];
  runKeyId: string; // uuid of the AES-GCM run key that encrypts receipts
  /** Employer's NEP-413 signature over the run key, so the key is attributable. */
  keyAttestation?: SignedMessage;
}

// ---------------------------------------------------------------------------
// Crypto envelopes
// ---------------------------------------------------------------------------

/** A WebCrypto-wrapped secret, stored as base64url. */
export interface Sealed {
  /** Wrapped key material (for a run key or a share-wrapped run key). */
  data: string;
  iv: string; // AES-GCM IV for receipt payloads
  tag?: string; // AES-GCM auth tag (some encodings bundle it)
  alg: string; // "AES-GCM-256" | "AES-KW-256"
  /** Salt/iv used to derive the master key when this seal came from a user passphrase. */
  salt?: string;
}

/** An encrypted receipts blob inside a run. */
export interface EncryptedReceipts {
  sealed: Sealed; // AES-GCM ciphertext of Receipt[]
}

// ---------------------------------------------------------------------------
// Auditor shares
// ---------------------------------------------------------------------------

export type ShareScope =
  | { kind: "run" }
  | { kind: "payment"; paymentId: string }
  | { kind: "range"; from: string; to: string }; // ISO dates, inclusive

export interface AuditorShare {
  id: string; // uuid — also the share token's nonce
  runId: string;
  employer: string;
  scope: ShareScope;
  expiresAt: string; // ISO — enforced on the auditor page
  createdAt: string;
  /** The run key, wrapped with a per-share AES-KW key. */
  wrappedRunKey: Sealed;
  /** Signed payload (NEP-413) binding employer, run, scope, expiry and key wrap. */
  signature: SignedMessage;
  /** Public key of the master key that can unwrap wrappedRunKey. */
  shareKeyPublic?: string;
  title?: string;
}

/** NEP-413 signed-message shape (as returned by near-connect signMessage). */
export interface SignedMessage {
  accountId: string;
  publicKey: string;
  signature: string; // base64
}

/** Payload actually signed with NEP-413 for a share. */
export interface ShareSignedPayload {
  type: "veilroll/auditor-share";
  version: 1;
  employer: string;
  runId: string;
  scope: ShareScope;
  expiresAt: string;
  runKeyWrapped: Sealed;
}

/** The token that travels in the auditor link fragment. */
export interface ShareToken {
  v: 1;
  shareId: string;
  runId: string;
  employer: string;
  scope: ShareScope;
  expiresAt: string;
  wrappedRunKey: Sealed;
  signature: SignedMessage;
  /** master-key material to unwrap wrappedRunKey (single self-contained share). */
  shareKey: { iv: string; data: string; salt: string };
  /**
   * The exact 32-byte NEP-413 nonce that was signed, base64url. Carried so the
   * auditor can genuinely re-verify with near-api-js verifyMessage (it needs the
   * original nonce). Without it, verification can only be structural.
   */
  nonce: string;
  /**
   * AES-GCM ciphertext of ALL run receipts, so the link is self-contained and the
   * auditor needs nothing from the employer's device. The shared run key can
   * decrypt the whole blob; scoping is enforced by the signed payload and the
   * auditor UI, not by cryptography. That limitation is stated in the README.
   */
  receiptsBlob: { data: string; iv: string };
}

// ---------------------------------------------------------------------------
// Settlement provider (mock + live) — see src/core/settlement/SettlementProvider.ts
// ---------------------------------------------------------------------------

export interface PaymentIntent {
  id: string;
  originAsset: string;
  destinationAsset: string;
  amountIn: TokenAmount; // origin asset, smallest unit
  recipient: string;
  refundTo: string;
  confidentiality: Confidentiality;
  dry: boolean;
}

export interface ChainVerification {
  verified: boolean;
  method: "rpc" | "explorer-api" | "1click-status" | "none";
  observedAmount?: TokenAmount;
  reference?: string;
  checkedAt: string;
  note?: string;
}
