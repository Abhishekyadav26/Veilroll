/**
 * Auditor-side verification of an employer's NEP-413 share signature.
 *
 * near-api-js `verifyMessage` throws on failure (it does not return false) and
 * the docs warn the caller must also check the recipient and enforce nonce
 * freshness. So we: verify signature + key ownership via verifyMessage, check
 * the exact recipient, and require the nonce carried in the share token.
 */

import { JsonRpcProvider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import { payloadToString, tokenToPayload } from "@/core/share";
import type { ShareToken } from "@/core/types";
import { fromBase64, fromBase64Url } from "@/core/crypto/bytes";
import { RPC_URL, NETWORK } from "./near";

/** Must match the recipient used when signing (near.ts signNep413). */
export const SHARE_RECIPIENT = "veilroll.app";

export interface SignatureCheck {
  ok: boolean;
  reason?: string;
  signerAccountId?: string;
  signerPublicKey?: string;
  /** True when verifyMessage confirmed the key has FullAccess on the account. */
  keyOwnedByAccount?: boolean;
}

/**
 * Verify that `employer` really signed this share.
 *
 * verifyMessage queries the account's access keys, so the signing key must still
 * exist on chain. A key that was added only in the wallet session and later
 * deleted will fail here; that is reported as such, not hidden.
 */
export async function verifyShareSignature(token: ShareToken): Promise<SignatureCheck> {
  if (!token.nonce) {
    return {
      ok: false,
      reason: "This share link has no nonce, so the signature cannot be fully verified.",
      signerAccountId: token.signature?.accountId,
      signerPublicKey: token.signature?.publicKey,
    };
  }

  // The bundled demo account has no real key; say so plainly instead of surfacing
  // a low-level "invalid key length" error from the crypto library.
  if (token.signature?.publicKey?.includes("DEMoWaLLeT")) {
    return {
      ok: false,
      reason:
        "This share was signed by the built-in demo account, which has no private key. Signatures from a real wallet verify here against the employer's on-chain access keys.",
      signerAccountId: token.signature.accountId,
      signerPublicKey: token.signature.publicKey,
    };
  }

  const message = payloadToString(tokenToPayload(token));
  const provider = new JsonRpcProvider({ url: RPC_URL });

  try {
    await verifyMessage({
      signerAccountId: token.employer,
      signerPublicKey: token.signature.publicKey,
      payload: {
        message,
        recipient: SHARE_RECIPIENT,
        nonce: fromBase64Url(token.nonce),
      },
      signature: fromBase64(token.signature.signature),
      provider,
    });
    return {
      ok: true,
      signerAccountId: token.signature.accountId,
      signerPublicKey: token.signature.publicKey,
      keyOwnedByAccount: true,
    };
  } catch (e) {
    return {
      ok: false,
      reason: `NEP-413 verification failed: ${(e as Error).message}`,
      signerAccountId: token.signature?.accountId,
      signerPublicKey: token.signature?.publicKey,
    };
  }
}

/** Structural check: a signature is present and claims the employer's account. */
export function signatureIsPresent(token: ShareToken): boolean {
  return Boolean(
    token.signature?.accountId &&
      token.signature?.publicKey &&
      token.signature?.signature &&
      token.signature.accountId === token.employer,
  );
}

export function networkLabel(): string {
  return NETWORK;
}
