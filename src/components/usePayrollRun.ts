/**
 * Payroll orchestration.
 *
 * Responsibilities:
 *   - compose a run from rows
 *   - quote each payment through the active provider
 *   - execute with per-payment status, so one failure never blocks the rest
 *   - poll settlement and write receipts
 *
 * On the live path the deposit is a wallet transaction the user approves; this
 * hook never signs anything itself.
 */

import { useCallback, useState } from "react";
import { buildReceipt } from "@/core/receipts";
import { getProvider, isLiveMode } from "@/core/settlement";
import type { QuoteResult } from "@/core/settlement/SettlementProvider";
import type { Payment, PayrollRun, Receipt } from "@/core/types";
import { formatUnits, parseUnits } from "@/core/money";
import { randomId } from "@/core/crypto/bytes";
import { saveReceipts, saveRun } from "@/lib/store";

export interface DraftRow {
  key: string;
  recipient: string;
  amount: string; // human decimal
  assetId: string;
  symbol: string;
  decimals: number;
  chain: string;
  confidentiality: "public" | "basic" | "advanced";
}

export function emptyRow(over: Partial<DraftRow> = {}): DraftRow {
  return {
    key: randomId(),
    recipient: "",
    amount: "",
    assetId: "",
    symbol: "USDC",
    decimals: 6,
    chain: "arb",
    confidentiality: "basic",
    ...over,
  };
}

export function validateRow(row: DraftRow): string | null {
  if (!row.recipient.trim()) return "Recipient address is required";
  if (!row.amount.trim()) return "Amount is required";
  try {
    const units = parseUnits(row.amount, row.decimals);
    if (units <= 0n) return "Amount must be greater than zero";
  } catch (e) {
    return (e as Error).message;
  }
  if (!row.assetId) return "Choose an asset";
  return null;
}

export interface RunProgress {
  paymentId: string;
  stage: "quoting" | "quoted" | "approve" | "settling" | "done" | "error";
  message?: string;
  quote?: QuoteResult;
}

export function usePayrollRun() {
  const [progress, setProgress] = useState<Record<string, RunProgress>>({});
  const [busy, setBusy] = useState(false);

  const update = useCallback((paymentId: string, patch: Partial<RunProgress>) => {
    setProgress((p) => ({
      ...p,
      [paymentId]: { ...(p[paymentId] ?? { paymentId, stage: "quoting" }), ...patch },
    }));
  }, []);

  /** Build Payment objects from validated rows (no network). */
  const buildPayments = useCallback((rows: DraftRow[]): Payment[] => {
    const nowIso = new Date().toISOString();
    return rows.map((r) => ({
      id: randomId(),
      recipient: r.recipient.trim(),
      assetId: r.assetId,
      symbol: r.symbol,
      amount: parseUnits(r.amount, r.decimals).toString(),
      decimals: r.decimals,
      chain: r.chain,
      status: "draft" as const,
      confidentiality: r.confidentiality,
      createdAt: nowIso,
    }));
  }, []);

  /**
   * Quote every payment. In mock mode this is instant and offline; in live mode
   * it calls our server route (which holds the JWT).
   */
  const quoteAll = useCallback(
    async (payments: Payment[], originAsset: string, employer: string, dry: boolean) => {
      const provider = getProvider();
      const quotes: Record<string, QuoteResult> = {};
      const errors: Record<string, string> = {};

      for (const p of payments) {
        update(p.id, { stage: "quoting" });
        try {
          const quote = await provider.quote({
            id: p.id,
            originAsset,
            destinationAsset: p.assetId,
            amountIn: p.amount,
            recipient: p.recipient,
            refundTo: employer,
            confidentiality: p.confidentiality,
            dry,
          });
          quotes[p.id] = quote;
          update(p.id, { stage: "quoted", quote });
        } catch (e) {
          const msg = (e as Error).message;
          errors[p.id] = msg;
          update(p.id, { stage: "error", message: msg });
        }
      }
      return { quotes, errors };
    },
    [update],
  );

  /**
   * Execute a run: quote, then settle each payment independently. Returns the
   * updated run plus the receipts that were produced.
   */
  const executeRun = useCallback(
    async (opts: {
      run: PayrollRun;
      originAsset: string;
      dry: boolean;
      onApprovalNeeded?: (payment: Payment, quote: QuoteResult) => Promise<string | void>;
      /** Called after every payment transitions, so the UI can render live state. */
      onUpdate?: (run: PayrollRun, receipts: Receipt[]) => void;
    }): Promise<{ run: PayrollRun; receipts: Receipt[] }> => {
      const { run, originAsset, dry, onApprovalNeeded, onUpdate } = opts;
      const provider = getProvider();
      setBusy(true);

      const payments: Payment[] = run.payments.map((p) => ({ ...p }));
      const receipts: Receipt[] = [];
      const publish = () => onUpdate?.({ ...run, payments }, receipts);

      try {
        for (const p of payments) {
          update(p.id, { stage: "quoting" });
          let quote: QuoteResult;
          try {
            quote = await provider.quote({
              id: p.id,
              originAsset,
              destinationAsset: p.assetId,
              amountIn: p.amount,
              recipient: p.recipient,
              refundTo: run.employer,
              confidentiality: p.confidentiality,
              dry,
            });
          } catch (e) {
            p.status = "failed";
            p.lastError = (e as Error).message;
            update(p.id, { stage: "error", message: p.lastError });
            publish();
            continue;
          }

          p.status = "quoted";
          p.settlement = { ...(p.settlement ?? {}), quote: quote.snapshot };
          p.amount = quote.amountOut; // receipt records what will actually arrive
          publish();

          if (dry) {
            update(p.id, { stage: "done", quote });
            continue;
          }

          // Ask the wallet for approval. Live mode needs a real transaction; the
          // callback returns the deposit tx hash.
          let depositTx: string | void = undefined;
          if (onApprovalNeeded) {
            update(p.id, { stage: "approve" });
            p.status = "signing";
            try {
              depositTx = await onApprovalNeeded(p, quote);
              p.status = "submitted";
              publish();
            } catch (e) {
              p.status = "failed";
              p.lastError = (e as Error).message || "Wallet rejected the payment";
              update(p.id, { stage: "error", message: p.lastError });
              publish();
              continue;
            }
          }

          try {
            update(p.id, { stage: "settling" });
            const submitted = await provider.execute(
              {
                id: p.id,
                originAsset,
                destinationAsset: p.assetId,
                amountIn: quote.amountIn,
                recipient: p.recipient,
                refundTo: run.employer,
                confidentiality: p.confidentiality,
                dry,
              },
              quote,
            );
            p.settlement = {
              ...(p.settlement ?? {}),
              quote: quote.snapshot,
              depositTxHash: depositTx || submitted.depositTxHash,
              state: submitted.state,
            };
          } catch (e) {
            p.status = "failed";
            p.lastError = (e as Error).message;
            update(p.id, { stage: "error", message: p.lastError });
            publish();
            continue;
          }

          // Poll to a terminal state. Mock advances on each poll; live can take a while.
          const settled = await pollToTerminal(p, provider, update);
          if (settled) {
            p.status = settled.state === "SUCCESS" ? "settled" : "failed";
            p.settlement = {
              ...(p.settlement ?? {}),
              state: settled.state,
              destinationTxHash: settled.destinationTxHash,
              explorerUrl: settled.explorerUrl,
              amountOut: settled.amountOut ?? p.amount,
              settledAt: settled.updatedAt,
            };
          }
          // Clear the poll message: the payment is terminal now.
          update(p.id, { stage: "done", message: undefined });
          if (p.status === "settled") receipts.push(buildReceipt({ ...run, payments }, p));
          publish();
        }

        const updatedRun: PayrollRun = { ...run, payments };
        publish();
        return { run: updatedRun, receipts };
      } finally {
        setBusy(false);
      }
    },
    [update],
  );

  /**
   * Retry a single failed payment.
   *
   * Re-quotes and re-executes the same intent, then polls to a terminal state and
   * produces the receipt on success. Other payments are untouched — this mirrors
   * `signAndSendTransactions` not rolling back.
   */
  const retryPayment = useCallback(
    async (
      run: PayrollRun,
      paymentId: string,
      originAsset: string,
      onApprovalNeeded?: (payment: Payment, quote: QuoteResult) => Promise<string | void>,
    ): Promise<{ run: PayrollRun; receipt?: Receipt }> => {
      const provider = getProvider();
      const target = run.payments.find((x) => x.id === paymentId);
      if (!target) throw new Error("Payment not found");

      const p: Payment = { ...target };
      update(paymentId, { stage: "quoting" });
      p.status = "retry";

      try {
        const quote = await provider.quote({
          id: p.id,
          originAsset,
          destinationAsset: p.assetId,
          amountIn: p.amount,
          recipient: p.recipient,
          refundTo: run.employer,
          confidentiality: p.confidentiality,
          dry: false,
        });
        p.settlement = { ...(p.settlement ?? {}), quote: quote.snapshot };
        update(paymentId, { stage: "quoted", quote });

        if (onApprovalNeeded) {
          update(paymentId, { stage: "approve" });
          const tx = await onApprovalNeeded(p, quote);
          if (tx) p.settlement = { ...(p.settlement ?? {}), depositTxHash: tx };
        }

        update(paymentId, { stage: "settling", quote });
        await provider.execute(
          {
            id: p.id,
            originAsset,
            destinationAsset: p.assetId,
            amountIn: quote.amountIn,
            recipient: p.recipient,
            refundTo: run.employer,
            confidentiality: p.confidentiality,
            dry: false,
          },
          quote,
        );
        p.status = "submitted";

        const settled = await pollToTerminal(p, provider, update);
        let receipt: Receipt | undefined;
        if (settled) {
          p.status = settled.state === "SUCCESS" ? "settled" : "failed";
          p.settlement = {
            ...(p.settlement ?? {}),
            state: settled.state,
            destinationTxHash: settled.destinationTxHash,
            explorerUrl: settled.explorerUrl,
            amountOut: settled.amountOut ?? p.amount,
            settledAt: settled.updatedAt,
          };
          if (p.status === "settled") {
            p.lastError = undefined;
            receipt = buildReceipt(run, p);
          } else {
            p.lastError = `Settlement ended as ${settled.state}`;
          }
        }
        update(paymentId, { stage: p.status === "settled" ? "done" : "error", message: p.lastError });

        const payments = run.payments.map((x) => (x.id === paymentId ? p : x));
        return { run: { ...run, payments }, receipt };
      } catch (e) {
        p.status = "failed";
        p.lastError = (e as Error).message;
        update(paymentId, { stage: "error", message: p.lastError });
        const payments = run.payments.map((x) => (x.id === paymentId ? p : x));
        throw Object.assign(e as Error, { run: { ...run, payments } });
      }
    },
    [update],
  );

  return { progress, busy, buildPayments, quoteAll, executeRun, retryPayment };
}

/** Poll status until terminal or attempts exhausted. Returns the last status. */
async function pollToTerminal(
  payment: Payment,
  provider: ReturnType<typeof getProvider>,
  update: (id: string, patch: Partial<RunProgress>) => void,
  attempts = 30,
  delayMs = 1200,
) {
  let last = null as Awaited<ReturnType<typeof provider.status>> | null;
  for (let i = 0; i < attempts; i++) {
    try {
      last = await provider.status(payment.id, payment.settlement?.quote?.depositAddress);
    } catch {
      await sleep(delayMs);
      continue;
    }
    if (["SUCCESS", "FAILED", "REFUNDED"].includes(last.state)) return last;
    update(payment.id, { stage: "settling", message: `${last.state.replace(/_/g, " ").toLowerCase()}…` });
    await sleep(delayMs);
  }
  return last;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export { isLiveMode, formatUnits };
