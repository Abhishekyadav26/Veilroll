/**
 * Run storage.
 *
 * Prototype scope, stated plainly: there is no backend. Runs live in the
 * browser's localStorage. Receipts are stored AES-GCM encrypted under the run
 * key; the run key itself is wrapped by a device key that never leaves this
 * browser. That keeps receipts unreadable at rest, but it is NOT a server-side
 * custody design and it does not survive clearing site data.
 */

import type { PayrollRun, Receipt } from "@/core/types";
import {
  exportRaw,
  generateAesKey,
  generateRawKey,
  importKek,
  openGcm,
  sealGcm,
  unwrapAesKw,
  wrapAesKw,
} from "@/core/crypto/aes";
import { toBase64Url, fromBase64Url } from "@/core/crypto/bytes";

const RUNS_KEY = "veilroll.runs.v1";
const SEALED_KEY = "veilroll.sealed.v1";

/** A run as persisted: receipts are ciphertext, the key is device-wrapped. */
export interface StoredRun {
  run: PayrollRun;
  receipts: { data: string; iv: string };
  /** Run key wrapped by this device's key. */
  deviceWrappedRunKey: string;
}

export interface RunBundle {
  run: PayrollRun;
  receipts: Receipt[];
  runKey: CryptoKey;
}

// ---------------------------------------------------------------------------
// Device key (localStorage-backed, non-extractable in practice but we need
// export to persist it, so it is stored as raw bytes in localStorage).
// ---------------------------------------------------------------------------

/**
 * The device key must be an AES-KW key: it wraps the run key, and one CryptoKey
 * cannot serve both AES-GCM (payloads) and AES-KW (wrapping).
 */
async function getDeviceKey(): Promise<CryptoKey> {
  const existing = localStorage.getItem(SEALED_KEY);
  if (existing) {
    return importKek(fromBase64Url(existing));
  }
  const key = await generateRawKey();
  const raw = await exportRaw(key);
  localStorage.setItem(SEALED_KEY, toBase64Url(raw));
  return key;
}

function readAll(): Record<string, StoredRun> {
  try {
    return JSON.parse(localStorage.getItem(RUNS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, StoredRun>): void {
  localStorage.setItem(RUNS_KEY, JSON.stringify(all));
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function createRun(run: PayrollRun): Promise<CryptoKey> {
  const deviceKey = await getDeviceKey();
  const runKey = await generateAesKey();
  const wrapped = await wrapAesKw(runKey, deviceKey);

  const all = readAll();
  all[run.id] = {
    run,
    receipts: { data: "", iv: "" },
    deviceWrappedRunKey: wrapped,
  };
  writeAll(all);
  return runKey;
}

export async function listRuns(): Promise<PayrollRun[]> {
  return Object.values(readAll())
    .map((s) => s.run)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function loadRun(runId: string): Promise<RunBundle | null> {
  const all = readAll();
  const entry = all[runId];
  if (!entry) return null;

  const deviceKey = await getDeviceKey();
  let runKey: CryptoKey;
  try {
    runKey = await unwrapAesKw(entry.deviceWrappedRunKey, deviceKey);
  } catch {
    // Device key changed (different browser/profile).
    throw new Error("This run was created in another browser profile and cannot be opened here.");
  }

  let receipts: Receipt[] = [];
  if (entry.receipts?.data) {
    const opened = await openGcm<{ receipts: Receipt[] }>(entry.receipts, runKey);
    receipts = opened.receipts ?? [];
  }
  return { run: entry.run, receipts, runKey };
}

export async function saveRun(run: PayrollRun): Promise<void> {
  const all = readAll();
  const existing = all[run.id];
  if (!existing) throw new Error("Run not found");
  all[run.id] = { ...existing, run };
  writeAll(all);
}

export async function saveReceipts(runId: string, receipts: Receipt[], runKey: CryptoKey): Promise<void> {
  const all = readAll();
  const existing = all[runId];
  if (!existing) throw new Error("Run not found");
  const sealed = await sealGcm({ receipts }, runKey);
  all[runId] = { ...existing, receipts: sealed };
  writeAll(all);
}

/** Read the encrypted blob for a run (used when creating a share link). */
export function getEncryptedReceipts(runId: string): { data: string; iv: string } | null {
  const all = readAll();
  return all[runId]?.receipts ?? null;
}

export function deleteRun(runId: string): void {
  const all = readAll();
  delete all[runId];
  writeAll(all);
}
