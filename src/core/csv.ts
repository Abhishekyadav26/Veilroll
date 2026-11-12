/**
 * CSV export for auditors. RFC 4180: quote fields containing comma, quote or
 * newline; double embedded quotes; CRLF line endings.
 */

import type { Receipt } from "./types.ts";
import { formatUnits } from "./money.ts";

function cell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const CSV_HEADER = [
  "payment_id",
  "date",
  "settled_at",
  "recipient",
  "chain",
  "asset_id",
  "symbol",
  "amount",
  "amount_decimal",
  "amount_usd",
  "status",
  "confidentiality",
  "settlement_reference",
  "explorer_url",
] as const;

/**
 * Decimals come from each receipt. `decimalsById` is kept for callers that have a
 * fresher token registry and want to override it.
 */
export interface CsvOptions {
  decimalsById?: Record<string, number>;
}

export function receiptsToCsv(receipts: Receipt[], opts: CsvOptions = {}): string {
  const rows: string[] = [CSV_HEADER.join(",")];
  for (const r of receipts) {
    const decimals = opts.decimalsById?.[r.assetId] ?? r.decimals ?? 6;
    rows.push(
      [
        r.paymentId,
        r.date,
        r.settledAt ?? "",
        r.recipient,
        r.chain,
        r.assetId,
        r.symbol,
        r.amount,
        formatUnits(r.amount, decimals, decimals),
        r.amountUsd ?? "",
        r.status,
        r.confidentiality,
        r.settlementReference ?? "",
        r.explorerUrl ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  return rows.join("\r\n") + "\r\n";
}

/** Trigger a browser download of a CSV string. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
