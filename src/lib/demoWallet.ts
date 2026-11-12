/**
 * Demo wallet.
 *
 * A judge may not have a NEAR wallet extension installed, and mock mode needs no
 * chain interaction. This provides a clearly-labelled local "demo account" so the
 * full mock flow (run -> receipts -> share -> auditor) works offline.
 *
 * It is NEVER used to move funds: mock settlement never sends a transaction, and
 * live mode refuses to run without a real wallet.
 */

const DEMO_KEY = "veilroll.demoAccount";
export const DEMO_ACCOUNT = "demo-payroll.testnet";

export function isDemoAccount(id: string | undefined | null): boolean {
  return id === DEMO_ACCOUNT;
}

export function enableDemo(): void {
  try {
    localStorage.setItem(DEMO_KEY, "1");
  } catch {
    // storage blocked: demo still works for this session
  }
}

export function disableDemo(): void {
  try {
    localStorage.removeItem(DEMO_KEY);
  } catch {
    /* ignore */
  }
}

export function demoEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(DEMO_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * A deterministic placeholder signature for demo shares.
 *
 * This is not a real NEP-413 signature (there is no private key). The auditor
 * page reports it as unverified, which is the honest outcome and is visible in
 * the UI. Real flow: connect a wallet.
 */
export function demoSignature(): { accountId: string; publicKey: string; signature: string } {
  const bytes = new Uint8Array(64);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return {
    accountId: DEMO_ACCOUNT,
    publicKey: "ed25519:DEMoWaLLeT1111111111111111111111111111111111111",
    signature: btoa(bin),
  };
}
