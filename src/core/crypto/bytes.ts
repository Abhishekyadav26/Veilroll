/**
 * Byte/encoding helpers. Browser + Node 22 compatible: uses only
 * Uint8Array and WebCrypto-friendly primitives.
 */

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 =
    typeof btoa === "function"
      ? btoa(bin)
      : // eslint-disable-next-line @typescript-eslint/no-var-requires
        Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === "function") {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Standard base64 (not url-safe) — near-connect signatures are base64. */
export function toBase64(bytes: Uint8Array): string {
  return toBase64Url(bytes).replace(/-/g, "+").replace(/_/g, "/") + paddingFor(bytes);
}

function paddingFor(bytes: Uint8Array): string {
  const rem = bytes.length % 3;
  return rem === 0 ? "" : "=".repeat(3 - rem);
}

export function fromBase64(text: string): Uint8Array {
  const norm = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = norm + "=".repeat((4 - (norm.length % 4)) % 4);
  if (typeof atob === "function") {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

/** Cryptographically random bytes. Requires a WebCrypto-capable runtime (browser or Node 19+). */
export function randomBytes(n = 32): Uint8Array {
  const out = new Uint8Array(n);
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webcrypto?.getRandomValues) {
    throw new Error("No crypto.getRandomValues available in this runtime.");
  }
  webcrypto.getRandomValues(out);
  return out;
}

export function randomId(): string {
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webcrypto && "randomUUID" in webcrypto) return webcrypto.randomUUID();
  return toBase64Url(randomBytes(16));
}
