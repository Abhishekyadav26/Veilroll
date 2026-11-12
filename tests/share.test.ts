import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAesKey } from "../src/core/crypto/aes.ts";
import { encryptReceipts } from "../src/core/receipts.ts";
import {
  decodeShareToken,
  encodeShareToken,
  filterByScope,
  isExpired,
  openShare,
  prepareShare,
  receiptInScope,
  signShare,
} from "../src/core/share.ts";
import type { PayrollRun, Receipt, ShareScope } from "../src/core/types.ts";

function receipt(id: string, date: string): Receipt {
  return {
    paymentId: id,
    runId: "run-1",
    recipient: `0x${id}`,
    assetId: "nep141:a",
    symbol: "USDC",
    decimals: 6,
    amount: "1000000",
    chain: "arb",
    status: "settled",
    confidentiality: "basic",
    date,
    settlementReference: `0xtx_${id}`,
  };
}

const receipts: Receipt[] = [
  receipt("p1", "2026-11-01T12:00:00.000Z"),
  receipt("p2", "2026-11-05T12:00:00.000Z"),
  receipt("p3", "2026-11-10T12:00:00.000Z"),
];

const run: PayrollRun = {
  id: "run-1",
  employer: "acme.near",
  name: "Payroll",
  createdAt: "2026-11-01T00:00:00.000Z",
  currency: "USD",
  payments: [],
  runKeyId: "k",
};

test("scope filtering: run, single payment, inclusive date range", () => {
  assert.equal(filterByScope(receipts, { kind: "run" }).length, 3);
  assert.deepEqual(
    filterByScope(receipts, { kind: "payment", paymentId: "p2" }).map((r) => r.paymentId),
    ["p2"],
  );
  // Range is inclusive of the whole end day.
  assert.deepEqual(
    filterByScope(receipts, { kind: "range", from: "2026-11-01", to: "2026-11-05" }).map((r) => r.paymentId),
    ["p1", "p2"],
  );
  assert.equal(filterByScope(receipts, { kind: "range", from: "2026-11-06", to: "2026-11-09" }).length, 0);
});

test("receiptInScope rejects unparseable dates rather than including them", () => {
  const bad = receipt("bad", "not-a-date");
  assert.equal(receiptInScope(bad, { kind: "range", from: "2026-01-01", to: "2026-12-31" }), false);
});

test("a share reveals only in-scope receipts to the auditor", async () => {
  const runKey = await generateAesKey();
  const blob = await encryptReceipts(receipts, runKey);

  const scope: ShareScope = { kind: "payment", paymentId: "p2" };
  const prepared = await prepareShare({
    run,
    runKey,
    scope,
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
    receiptsBlob: blob,
  });
  const signed = signShare(prepared, { accountId: "acme.near", publicKey: "ed25519:abc", signature: "c2ln" });

  const token = decodeShareToken(encodeShareToken(signed.token));
  const opened = await openShare(token);
  assert.deepEqual(opened.map((r) => r.paymentId), ["p2"]);
});

test("full-run share reveals everything; the blob survives the URL round-trip", async () => {
  const runKey = await generateAesKey();
  const blob = await encryptReceipts(receipts, runKey);
  const prepared = await prepareShare({
    run,
    runKey,
    scope: { kind: "run" },
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
    receiptsBlob: blob,
  });
  const signed = signShare(prepared, { accountId: "acme.near", publicKey: "ed25519:abc", signature: "c2ln" });
  const opened = await openShare(decodeShareToken(encodeShareToken(signed.token)));
  assert.equal(opened.length, 3);
});

test("expired shares are refused before any decryption", async () => {
  const runKey = await generateAesKey();
  const blob = await encryptReceipts(receipts, runKey);
  const past = new Date(Date.now() - 60_000).toISOString();
  const prepared = await prepareShare({
    run,
    runKey,
    scope: { kind: "run" },
    expiresAt: past,
    receiptsBlob: blob,
  });
  const token = decodeShareToken(encodeShareToken(prepared.token));
  assert.equal(isExpired(token), true);
  await assert.rejects(() => openShare(token), /expired/i);
});

test("each share uses a distinct wrapped key (revoking one cannot affect another)", async () => {
  const runKey = await generateAesKey();
  const blob = await encryptReceipts(receipts, runKey);
  const expiry = new Date(Date.now() + 864e5).toISOString();
  const a = await prepareShare({ run, runKey, scope: { kind: "run" }, expiresAt: expiry, receiptsBlob: blob });
  const b = await prepareShare({ run, runKey, scope: { kind: "run" }, expiresAt: expiry, receiptsBlob: blob });
  assert.notEqual(a.token.wrappedRunKey.data, b.token.wrappedRunKey.data);
  assert.notEqual(a.token.shareKey.data, b.token.shareKey.data);
});

test("a tampered share key cannot open the receipts", async () => {
  const runKey = await generateAesKey();
  const blob = await encryptReceipts(receipts, runKey);
  const prepared = await prepareShare({
    run,
    runKey,
    scope: { kind: "run" },
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
    receiptsBlob: blob,
  });
  const token = decodeShareToken(encodeShareToken(prepared.token));
  // Swap in an unrelated KEK.
  const other = await prepareShare({
    run,
    runKey: await generateAesKey(),
    scope: { kind: "run" },
    expiresAt: token.expiresAt,
    receiptsBlob: blob,
  });
  const forged = { ...token, shareKey: other.token.shareKey };
  await assert.rejects(() => openShare(forged));
});

test("decodeShareToken rejects junk", () => {
  assert.throws(() => decodeShareToken("bm90LWEtc2hhcmU"), /valid Veilroll share/);
});
