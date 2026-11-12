/**
 * WebCrypto wrappers. Receipts are encrypted with AES-GCM under a per-run key;
 * the run key is wrapped per-share with AES-KW. No custom crypto primitives.
 */

import { fromBase64Url, randomBytes, toBase64Url, utf8 } from "./bytes.ts";

export type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

/** Resolve the WebCrypto subtle object (browser, or Node 19+ via globalThis.crypto). */
async function subtle(): Promise<SubtleCrypto> {
  const webcrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (!webcrypto?.subtle) {
    throw new Error("WebCrypto is unavailable in this runtime. Veilroll needs a secure context (https or localhost).");
  }
  return webcrypto.subtle;
}

/**
 * WebCrypto types want ArrayBuffer-backed views. Node/TS 5.7+ widen
 * Uint8Array to ArrayBufferLike, so copy into a plain ArrayBuffer when needed.
 */
function buf(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

export async function generateAesKey(): Promise<CryptoKey> {
  return (await subtle()).generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Raw 32-byte key material, for wrapping (AES-KW). */
export async function generateRawKey(): Promise<CryptoKey> {
  return (await subtle()).importKey(
    "raw",
    buf(randomBytes(32)),
    { name: "AES-KW" },
    true,
    ["wrapKey", "unwrapKey"],
  );
}

export async function exportRaw(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await (await subtle()).exportKey("raw", key));
}

export async function importRaw(
  bytes: Uint8Array,
  usage: KeyUsage[] = ["encrypt", "decrypt"],
): Promise<CryptoKey> {
  return (await subtle()).importKey("raw", buf(bytes), { name: "AES-GCM" }, true, usage);
}

/** Import raw bytes as an AES-KW key-encryption key. */
export async function importKek(bytes: Uint8Array): Promise<CryptoKey> {
  return (await subtle()).importKey("raw", buf(bytes), { name: "AES-KW" }, true, [
    "wrapKey",
    "unwrapKey",
  ]);
}

// ---------------------------------------------------------------------------
// AES-GCM envelope (receipt payloads)
// ---------------------------------------------------------------------------

export async function sealGcm(
  plaintext: Json | Uint8Array | string,
  key: CryptoKey,
): Promise<{ data: string; iv: string }> {
  const subtleApi = await subtle();
  const iv = randomBytes(12);
  const payload: ArrayBuffer =
    typeof plaintext === "string"
      ? buf(utf8(plaintext))
      : plaintext instanceof Uint8Array
        ? buf(plaintext)
        : buf(utf8(JSON.stringify(plaintext)));

  const ct = new Uint8Array(
    await subtleApi.encrypt({ name: "AES-GCM", iv: buf(iv) }, key, payload),
  );
  return { data: toBase64Url(ct), iv: toBase64Url(iv) };
}

export async function openGcm<T>(
  sealed: { data: string; iv: string },
  key: CryptoKey,
): Promise<T> {
  const subtleApi = await subtle();
  const pt = await subtleApi.decrypt(
    { name: "AES-GCM", iv: buf(fromBase64Url(sealed.iv)) },
    key,
    buf(fromBase64Url(sealed.data)),
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// ---------------------------------------------------------------------------
// AES-KW key wrapping (per-share wrap of the run key)
// ---------------------------------------------------------------------------

export async function wrapAesKw(keyToWrap: CryptoKey, kek: CryptoKey): Promise<string> {
  const wrapped = new Uint8Array(
    await (await subtle()).wrapKey("raw", keyToWrap, kek, { name: "AES-KW" }),
  );
  return toBase64Url(wrapped);
}

export async function unwrapAesKw(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
  return (await subtle()).unwrapKey(
    "raw",
    buf(fromBase64Url(wrapped)),
    kek,
    { name: "AES-KW" },
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------------
// Passphrase-derived key (encrypted store)
// ---------------------------------------------------------------------------

export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const subtleApi = await subtle();
  const base = await subtleApi.importKey("raw", buf(utf8(password)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtleApi.deriveKey(
    { name: "PBKDF2", salt: buf(salt), iterations: 210_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}
