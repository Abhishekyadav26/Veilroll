import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { PrivacyPill, StatusPill } from "@/components/Pills";
import { usePayrollRun } from "@/components/usePayrollRun";
import { buildReceipt } from "@/core/receipts";
import { formatUnits } from "@/core/money";
import { getProvider, isLiveMode } from "@/core/settlement";
import type { Payment, PayrollRun, Receipt } from "@/core/types";
import { DEFAULT_ORIGIN_ASSET } from "@/components/assets";
import { loadRun, saveReceipts, saveRun } from "@/lib/store";

export default function RunPage() {
  const router = useRouter();
  const runId = typeof router.query.runId === "string" ? router.query.runId : "";
  const { account, wallet } = useWallet();

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [runKey, setRunKey] = useState<CryptoKey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [origin, setOrigin] = useState(DEFAULT_ORIGIN_ASSET);
  const [dry, setDry] = useState(false);
  const startedRef = useRef(false);

  const { progress, busy, executeRun, retryPayment } = usePayrollRun();

  useEffect(() => {
    if (!runId) return;
    loadRun(runId)
      .then((bundle) => {
        if (!bundle) return setLoadError("Run not found in this browser.");
        setRun(bundle.run);
        setReceipts(bundle.receipts);
        setRunKey(bundle.runKey);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, [runId]);

  useEffect(() => {
    if (typeof router.query.dry === "string") setDry(router.query.dry === "1");
  }, [router.query.dry]);

  /** Wallet approval hook for the live path. Mock mode needs none. */
  const approve = useCallback(
    async (_payment: Payment, quote: { depositAddress?: string; amountIn: string }) => {
      if (!isLiveMode()) return undefined;
      if (!wallet || !account) throw new Error("Connect your wallet to approve payments.");
      if (!quote.depositAddress) throw new Error("No deposit address in the quote.");
      // Live deposits are real transfers of the origin asset to the 1Click deposit
      // address. Kept behind an explicit confirmation; never auto-signed.
      const ok = window.confirm(
        `Approve a real deposit of ${quote.amountIn} smallest units to\n${quote.depositAddress}\n\nThis spends funds from ${account.accountId}.`,
      );
      if (!ok) throw new Error("Cancelled by user.");
      throw new Error(
        "Live deposit signing is not wired to a funded account in this build. Use mock mode, or add your dev account in src/lib/deposit.ts. See README.",
      );
    },
    [wallet, account],
  );

  const start = useCallback(async () => {
    if (!run || !runKey) return;
    const result = await executeRun({
      run,
      originAsset: origin,
      dry,
      onApprovalNeeded: dry ? undefined : approve,
      // Mirror live progress so the table and counters update during the run.
      onUpdate: (live, liveReceipts) => {
        setRun(live);
        setReceipts(mergeReceipts(receipts, liveReceipts));
      },
    });
    setRun(result.run);
    const merged = mergeReceipts(receipts, result.receipts);
    setReceipts(merged);
    await saveRun(result.run);
    await saveReceipts(result.run.id, merged, runKey);
  }, [run, runKey, executeRun, origin, dry, approve, receipts]);

  // Autostart once, when arriving from the composer.
  useEffect(() => {
    if (startedRef.current) return;
    if (!run || !runKey) return;
    if (router.query.autostart !== "1") return;
    startedRef.current = true;
    start();
  }, [run, runKey, router.query.autostart, start]);

  /** Re-poll a single submitted payment. */
  async function refresh(p: Payment) {
    const provider = getProvider();
    const st = await provider.status(p.id, p.settlement?.quote?.depositAddress);
    const updated = run!.payments.map((x) =>
      x.id === p.id
        ? {
            ...x,
            status: st.state === "SUCCESS" ? ("settled" as const) : ["FAILED", "REFUNDED"].includes(st.state) ? ("failed" as const) : x.status,
            settlement: {
              ...(x.settlement ?? {}),
              state: st.state,
              destinationTxHash: st.destinationTxHash ?? x.settlement?.destinationTxHash,
              explorerUrl: st.explorerUrl ?? x.settlement?.explorerUrl,
              amountOut: st.amountOut ?? x.settlement?.amountOut,
              settledAt: st.state === "SUCCESS" ? st.updatedAt : x.settlement?.settledAt,
            },
          }
        : x,
    );
    const nextRun = { ...run!, payments: updated };
    setRun(nextRun);
    await saveRun(nextRun);
    const target = updated.find((x) => x.id === p.id)!;
    if (target.status === "settled") {
      const merged = mergeReceipts(receipts, [buildReceipt(nextRun, target)]);
      setReceipts(merged);
      if (runKey) await saveReceipts(nextRun.id, merged, runKey);
    }
  }

  async function onRetry(p: Payment) {
    if (!run || !runKey) return;
    try {
      const result = await retryPayment(run, p.id, origin, dry ? undefined : approve);
      setRun(result.run);
      if (result.receipt) {
        const merged = mergeReceipts(receipts, [result.receipt]);
        setReceipts(merged);
        await saveReceipts(result.run.id, merged, runKey);
      }
      await saveRun(result.run);
    } catch (e) {
      // The partially updated run is attached to the error so the UI can show it.
      const withRun = (e as Error & { run?: PayrollRun }).run;
      if (withRun) {
        setRun(withRun);
        await saveRun(withRun);
      }
    }
  }

  if (loadError) {
    return (
      <div className="panel" style={{ marginTop: "2rem" }}>
        <h2>Cannot open this run</h2>
        <p className="muted">{loadError}</p>
      </div>
    );
  }

  if (!run) {
    return <p className="muted" style={{ marginTop: "2rem" }}>Loading run…</p>;
  }

  const settledCount = run.payments.filter((p) => p.status === "settled").length;
  const failedCount = run.payments.filter((p) => p.status === "failed").length;
  const isOwner = account?.accountId === run.employer;

  return (
    <>
      <Head>
        <title>{run.name} — Veilroll</title>
      </Head>

      <div className="between" style={{ margin: "2rem 0 1rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.2rem" }}>{run.name}</h1>
          <p className="muted small mono" style={{ margin: 0 }}>
            {run.employer} · {new Date(run.createdAt).toLocaleString()} · run {run.id}
          </p>
        </div>
        <div className="row">
          <span className="pill good">{settledCount} settled</span>
          {failedCount > 0 && <span className="pill bad">{failedCount} failed</span>}
          <span className="pill">{run.payments.length} payments</span>
        </div>
      </div>

      {!isOwner && (
        <div className="notice warn" style={{ marginBottom: "1rem" }}>
          You are viewing this run as <b>{account?.accountId ?? "a guest"}</b>; the employer is{" "}
          <b>{run.employer}</b>. Only the employer can create auditor shares from this page.
        </div>
      )}

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="between">
          <h2 style={{ margin: 0 }}>Payments</h2>
          <div className="row">
            <label className="row tiny" style={{ margin: 0, gap: "0.4rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={dry}
                onChange={(e) => setDry(e.target.checked)}
                style={{ width: "auto" }}
              />
              dry run
            </label>
            <button className="primary small" onClick={start} disabled={busy || !isOwner}>
              {busy ? "Working…" : dry ? "Quote all (dry)" : "Execute run"}
            </button>
          </div>
        </div>

        <table style={{ marginTop: "0.75rem" }}>
          <thead>
            <tr>
              <th>Recipient</th>
              <th className="num">Amount</th>
              <th>Asset</th>
              <th>Privacy</th>
              <th>Status</th>
              <th>Settlement</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {run.payments.map((p) => {
              const prog = progress[p.id];
              return (
                <tr key={p.id}>
                  <td className="mono-sm">{shortAddr(p.recipient)}</td>
                  <td className="num">
                    {formatUnits(p.amount, p.decimals)} {p.symbol}
                  </td>
                  <td className="small">{p.chain}</td>
                  <td>
                    <PrivacyPill confidentiality={p.confidentiality} />
                  </td>
                  <td>
                    <StatusPill status={liveStatus(p, prog?.stage)} />
                    {prog?.message && <div className="tiny dim">{prog.message}</div>}
                    {p.lastError && <div className="tiny" style={{ color: "var(--bad)" }}>{p.lastError}</div>}
                  </td>
                  <td className="mono-sm">
                    {p.settlement?.destinationTxHash ? (
                      p.settlement.explorerUrl ? (
                        <a href={p.settlement.explorerUrl} target="_blank" rel="noreferrer">
                          {shortHash(p.settlement.destinationTxHash)}
                        </a>
                      ) : (
                        shortHash(p.settlement.destinationTxHash)
                      )
                    ) : p.settlement?.state ? (
                      <span className="dim">{p.settlement.state.replace(/_/g, " ")}</span>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {p.status === "submitted" && (
                      <button className="ghost small" onClick={() => refresh(p)}>
                        Refresh
                      </button>
                    )}
                    {(p.status === "failed" || p.status === "retry") && isOwner && (
                      <button className="ghost small" onClick={() => onRetry(p)} disabled={busy}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="between">
          <div>
            <h2 style={{ marginBottom: "0.2rem" }}>Receipts ({receipts.length})</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Encrypted with this run&apos;s key (AES-GCM). Only a share decrypts them.
            </p>
          </div>
          <Link href={`/run/${run.id}/share`} className="btn primary small">
            Create auditor share →
          </Link>
        </div>

        {receipts.length > 0 && (
          <table style={{ marginTop: "0.75rem" }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Recipient</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Settlement ref</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.paymentId}>
                  <td className="small muted">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="mono-sm">{shortAddr(r.recipient)}</td>
                  <td className="num">
                    {formatUnits(r.amount, r.decimals)} {r.symbol}
                  </td>
                  <td>
                    <span className={`pill ${r.status === "settled" ? "good" : "bad"}`}>{r.status}</span>
                  </td>
                  <td className="mono-sm dim">{r.settlementReference ? shortHash(r.settlementReference) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {receipts.length === 0 && (
          <p className="muted small" style={{ marginTop: "0.75rem" }}>
            No receipts yet. Execute the run to produce them.
          </p>
        )}
      </div>

      <p className="tiny dim">
        Each payment settles independently: <code>signAndSendTransactions</code> does not roll back, so a
        failed row is retried on its own without touching the settled ones.
      </p>
    </>
  );
}

function mergeReceipts(existing: Receipt[], incoming: Receipt[]): Receipt[] {
  const byId = new Map(existing.map((r) => [r.paymentId, r]));
  for (const r of incoming) byId.set(r.paymentId, r);
  return [...byId.values()];
}

/** Prefer the in-flight stage over the stored status, so the pill stays truthful. */
function liveStatus(p: Payment, stage?: string): Payment["status"] {
  if (stage === "quoting") return "draft";
  if (stage === "quoted") return "quoted";
  if (stage === "approve") return "signing";
  if (stage === "settling") return "submitted";
  return p.status;
}

function shortAddr(a: string): string {
  return a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a;
}
function shortHash(h: string): string {
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}
