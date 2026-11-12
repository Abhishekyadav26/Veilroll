/**
 * NEAR wallet + reads.
 *
 * Wallet: @hot-labs/near-connect (NOT the deprecated @near-wallet-selector).
 * Reads: JsonRpcProvider from near-api-js (NearConnect has no view calls).
 *
 * Money-moving actions always go through wallet.signAndSendTransaction(s), so
 * every payment needs real user approval. There is no function-call key path for
 * transfers anywhere in this app.
 */

import { NearConnector, type Account, type NearWalletBase } from "@hot-labs/near-connect";

export type { Account, NearWalletBase };

let connector: NearConnector | null = null;

export function getConnector(): NearConnector {
  if (typeof window === "undefined") {
    throw new Error("getConnector() is browser-only");
  }
  if (!connector) {
    connector = new NearConnector({ network: "testnet", autoConnect: true });
  }
  return connector;
}

export const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "mainnet" | "testnet";

export const RPC_URL =
  process.env.NEXT_PUBLIC_NEAR_RPC ??
  (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://rpc.testnet.fastnear.com");

/** Reconnect silently if a session exists. Returns null when signed out. */
export async function restoreSession(): Promise<{ wallet: NearWalletBase; account: Account } | null> {
  try {
    const c = getConnector();
    const { wallet, accounts } = await c.getConnectedWallet();
    if (!wallet || !accounts?.length) return null;
    return { wallet, account: accounts[0] };
  } catch {
    return null;
  }
}

/** Open the wallet selector and sign in. */
export async function connectWallet(): Promise<{ wallet: NearWalletBase; account: Account }> {
  const c = getConnector();
  const wallet = await c.connect();
  const accounts = await wallet.getAccounts();
  if (!accounts.length) throw new Error("Wallet returned no accounts.");
  return { wallet, account: accounts[0] };
}

export async function disconnectWallet(): Promise<void> {
  try {
    const c = getConnector();
    await c.disconnect();
  } catch {
    // ignore: nothing connected
  }
}

/**
 * Sign a human-readable message with NEP-413 (wallet.signMessage).
 * Returns the signature plus the exact nonce used, which the verifier needs.
 */
export async function signNep413(
  wallet: NearWalletBase,
  signerId: string,
  message: string,
  nonce: Uint8Array,
): Promise<import("@/core/types").SignedMessage> {
  const signed = await wallet.signMessage({
    message,
    recipient: "veilroll.app",
    nonce,
    network: NETWORK,
    signerId,
  });
  return {
    accountId: signed.accountId,
    publicKey: signed.publicKey,
    signature: signed.signature,
  };
}
