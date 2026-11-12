/**
 * Auditor shares.
 *
 * Flow: the run key (AES-GCM) is wrapped with a fresh per-share KEK (AES-KW).
 * The wrapped key + scope + expiry + employer are signed with NEP-413 by the
 * employer's wallet, so the auditor can attribute the disclosure. The share
 * token travels in the URL *fragment* (never sent to a server), which is why the
 * app itself cannot read a share it did not just create.
 */

import type {
  AuditorShare,
  PayrollRun,
  Receipt,
  ShareScope,
  ShareSignedPayload,
  ShareToken,
  SignedMessage,
} from "./types.ts";
import {
  exportRaw,
  generateRawKey,
  importKek,
  openGcm,
  sealGcm,
  unwrapAesKw,
  wrapAesKw,
} from "./crypto/aes.ts";
import { fromBase64Url, randomBytes, randomId, toBase64Url } from "./crypto/bytes.ts";

// ---------------------------------------------------------------------------
// Scope filtering
// ---------------------------------------------------------------------------

/** Does a receipt fall inside this share's scope? Pure and testable. */
export function receiptInScope(receipt: Receipt, scope: ShareScope): boolean {
  switch (scope.kind) {
    case "run":
      return true;
    case "payment":
      return receipt.paymentId === scope.paymentId;
    case "range": {
      const d = Date.parse(receipt.date);
      const from = Date.parse(scope.from);
      const to = Date.parse(scope.to);
      if (Number.isNaN(d)) return false;
      // Inclusive on both ends, to the end of the "to" day.
      return d >= from && d <= to + 24 * 60 * 60 * 1000 - 1;
    }
    default:
      return false;
  }
}

export function filterByScope(receipts: Receipt[], scope: ShareScope): Receipt[] {
  return receipts.filter((r) => receiptInScope(r, scope));
}

/** Human label for a scope, used in the UI and the CSV. */
export function describeScope(scope: ShareScope): string {
  switch (scope.kind) {
    case "run":
      return "Entire run";
    case "payment":
      return `Single payment (${scope.paymentId.slice(0, 8)})`;
    case "range":
      return `Date range ${scope.from.slice(0, 10)} → ${scope.to.slice(0, 10)}`;
    default:
      // Exhaustive over ShareScope; kept for safety if a new kind is added.
      return "Unknown scope";
  }
}

// ---------------------------------------------------------------------------
// Share payload (what gets signed)
// ---------------------------------------------------------------------------

export function buildSharePayload(
  run: PayrollRun,
  scope: ShareScope,
  expiresAt: string,
  wrappedRunKey: { data: string; iv: string },
): ShareSignedPayload {
  return {
    type: "veilroll/auditor-share",
    version: 1,
    employer: run.employer,
    runId: run.id,
    scope,
    expiresAt,
    runKeyWrapped: {
      data: wrappedRunKey.data,
      iv: wrappedRunKey.iv,
      alg: "AES-KW-256",
    },
  };
}

/** Deterministic string signed via NEP-413, so an auditor can rebuild it exactly. */
export function payloadToString(p: ShareSignedPayload): string {
  // Stable key order: build explicitly rather than JSON.stringify(object).
  return JSON.stringify({
    type: p.type,
    version: p.version,
    employer: p.employer,
    runId: p.runId,
    scope: p.scope,
    expiresAt: p.expiresAt,
    runKeyWrapped: { data: p.runKeyWrapped.data, iv: p.runKeyWrapped.iv },
  });
}

// ---------------------------------------------------------------------------
// Creation (employer side)
// ---------------------------------------------------------------------------

export interface CreateShareResult {
  share: AuditorShare;
  /** Everything needed to build the fragment link. */
  token: ShareToken;
  /** NEP-413 params the wallet must sign. */
  signRequest: { message: string; nonce: Uint8Array };
}

/**
 * Prepare a share: generate a per-share KEK, wrap the run key, and produce the
 * exact message the employer signs. Signing itself happens in the wallet.
 */
export async function prepareShare(opts: {
  run: PayrollRun;
  runKey: CryptoKey;
  scope: ShareScope;
  expiresAt: string;
  title?: string;
  /** Encrypted receipts blob, so the resulting link is self-contained. */
  receiptsBlob: { data: string; iv: string };
}): Promise<CreateShareResult> {
  const { run, runKey, scope, expiresAt, receiptsBlob } = opts;
  const kek = await generateRawKey();
  const wrapped = await wrapAesKw(runKey, kek);

  // Material the auditor needs to rebuild the KEK.
  const kekRaw = await exportRaw(kek);
  const shareKey = { iv: "", data: toBase64Url(kekRaw), salt: "" };

  const payload = buildSharePayload(run, scope, expiresAt, { data: wrapped, iv: "" });
  const message = payloadToString(payload);
  const nonce = randomBytes(32);
  const shareId = randomId();

  // Placeholder signature — replaced by signShare() after the wallet responds.
  const unsigned: SignedMessage = { accountId: run.employer, publicKey: "", signature: "" };

  const share: AuditorShare = {
    id: shareId,
    runId: run.id,
    employer: run.employer,
    scope,
    expiresAt,
    createdAt: new Date().toISOString(),
    wrappedRunKey: { data: wrapped, iv: "", alg: "AES-KW-256" },
    signature: unsigned,
    title: opts.title,
  };

  const token: ShareToken = {
    v: 1,
    shareId,
    runId: run.id,
    employer: run.employer,
    scope,
    expiresAt,
    wrappedRunKey: share.wrappedRunKey,
    signature: unsigned,
    shareKey,
    nonce: toBase64Url(nonce),
    receiptsBlob,
  };

  return { share, token, signRequest: { message, nonce } };
}

/** Attach the wallet's NEP-413 signature to a prepared share. */
export function signShare(
  result: CreateShareResult,
  signed: SignedMessage,
): CreateShareResult {
  return {
    ...result,
    share: { ...result.share, signature: signed },
    token: { ...result.token, signature: signed },
  };
}

// ---------------------------------------------------------------------------
// Decimal share token (URL fragment)
// ---------------------------------------------------------------------------

export function encodeShareToken(token: ShareToken): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(token)));
}

export function decodeShareToken(text: string): ShareToken {
  let obj: ShareToken;
  try {
    const bytes = fromBase64Url(text.trim());
    obj = JSON.parse(new TextDecoder().decode(bytes)) as ShareToken;
  } catch {
    throw new Error("Not a valid Veilroll share link.");
  }
  if (obj?.v !== 1 || !obj.wrappedRunKey?.data || !obj.shareKey?.data) {
    throw new Error("Not a valid Veilroll share link.");
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Opening (auditor side)
// ---------------------------------------------------------------------------

export function isExpired(share: { expiresAt: string }, at: Date = new Date()): boolean {
  const t = Date.parse(share.expiresAt);
  if (Number.isNaN(t)) return true;
  return at.getTime() > t;
}

/**
 * Unwrap the run key from a share token and decrypt the run's receipts blob,
 * returning only receipts inside the share's scope.
 */
export async function openShare(
  token: ShareToken,
  encryptedBlob?: { data: string; iv: string },
): Promise<Receipt[]> {
  if (isExpired(token)) {
    throw new Error("This auditor link has expired.");
  }
  const blob = encryptedBlob ?? token.receiptsBlob;
  if (!blob?.data) throw new Error("This share has no receipts attached.");
  const kek = await importKek(fromBase64Url(token.shareKey.data));
  const runKey = await unwrapAesKw(token.wrappedRunKey.data, kek);
  const { receipts } = await openGcm<{ receipts: Receipt[] }>(blob, runKey);
  if (!Array.isArray(receipts)) throw new Error("Malformed receipt payload");
  return filterByScope(receipts, token.scope);
}

/** Rebuild the signed message from a token, for NEP-413 verification. */
export function tokenToPayload(token: ShareToken): ShareSignedPayload {
  return {
    type: "veilroll/auditor-share",
    version: 1,
    employer: token.employer,
    runId: token.runId,
    scope: token.scope,
    expiresAt: token.expiresAt,
    runKeyWrapped: token.wrappedRunKey,
  };
}

/** Encrypt receipts once for a run (helper used by the store). */
export async function sealRunReceipts(receipts: Receipt[], runKey: CryptoKey) {
  return sealGcm({ receipts }, runKey);
}
