/**
 * In-memory map of paymentId -> deposit address.
 *
 * Deliberately not a database: this is a prototype with no backend. If the
 * server restarts the map is empty, so the client also keeps the deposit address
 * inside its (encrypted) run payload and sends it explicitly.
 */

const addresses = new Map<string, { depositAddress: string; depositMemo?: string; at: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

export function rememberDeposit(paymentId: string, depositAddress: string, depositMemo?: string): void {
  purge();
  addresses.set(paymentId, { depositAddress, depositMemo, at: Date.now() });
}

export function lookupDeposit(paymentId: string): { depositAddress?: string; depositMemo?: string } {
  purge();
  const hit = addresses.get(paymentId);
  return { depositAddress: hit?.depositAddress, depositMemo: hit?.depositMemo };
}

function purge(): void {
  const now = Date.now();
  for (const [k, v] of addresses) if (now - v.at > TTL_MS) addresses.delete(k);
}
