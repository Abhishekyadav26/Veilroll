import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKeyFromPassword, exportRaw, generateAesKey, generateRawKey, generateRawKey as _g, importRaw, openGcm, sealGcm, unwrapAesKw, wrapAesKw } from "../src/core/crypto/aes.ts";
import { randomBytes } from "../src/core/crypto/bytes.ts";

test("AES-GCM round-trips JSON and fails on tamper", async () => {
  const key = await generateAesKey();
  const payload = { receipts: [{ id: "a", amount: "100" }] };
  const sealed = await sealGcm(payload, key);
  const opened = await openGcm<typeof payload>(sealed, key);
  assert.deepEqual(opened, payload);

  // Tamper: flipping ciphertext must fail authentication, not return garbage.
  const bytes = sealed.data.slice(0, -4) + (sealed.data.endsWith("AA") ? "BB" : "AA");
  await assert.rejects(() => openGcm({ data: bytes, iv: sealed.iv }, key));
});

test("AES-KW wraps and unwraps the run key", async () => {
  const runKey = await generateAesKey();
  const kek = await generateRawKey();
  const wrapped = await wrapAesKw(runKey, kek);
  const unwrapped = await unwrapAesKw(wrapped, kek);

  const sealed = await sealGcm({ ok: true }, runKey);
  const opened = await openGcm<{ ok: boolean }>(sealed, unwrapped);
  assert.deepEqual(opened, { ok: true });
});

test("a different share KEK cannot unwrap the run key", async () => {
  const runKey = await generateAesKey();
  const kek = await generateRawKey();
  const otherKek = await generateRawKey();
  const wrapped = await wrapAesKw(runKey, kek);
  await assert.rejects(() => unwrapAesKw(wrapped, otherKek));
});

test("passphrase derivation is deterministic per salt and differs across salts", async () => {
  const saltA = randomBytes(16);
  const saltB = randomBytes(16);
  const k1 = await deriveKeyFromPassword("correct horse", saltA);
  const k2 = await deriveKeyFromPassword("correct horse", saltA);
  const k3 = await deriveKeyFromPassword("correct horse", saltB);

  const raw1 = await exportRaw(k1);
  const raw2 = await exportRaw(k2);
  const raw3 = await exportRaw(k3);
  assert.deepEqual([...raw1], [...raw2]);
  assert.notDeepEqual([...raw1], [...raw3]);
});

test("raw key import/export preserves material", async () => {
  const bytes = randomBytes(32);
  const key = await importRaw(bytes);
  const out = await exportRaw(key);
  assert.deepEqual([...out], [...bytes]);
});
