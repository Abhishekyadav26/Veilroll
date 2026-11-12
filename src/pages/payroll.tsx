import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { DEFAULT_ORIGIN_ASSET, loadAssets } from "@/components/assets";
import { PrivacyPill } from "@/components/Pills";
import { DraftRow, emptyRow, usePayrollRun, validateRow } from "@/components/usePayrollRun";
import { isLiveMode } from "@/core/settlement";
import type { Asset, Payment, PayrollRun } from "@/core/types";
import { parseUnits } from "@/core/money";
import { createRun, listRuns } from "@/lib/store";

const DEFAULT_ROWS: DraftRow[] = [
  { key: "r1", recipient: "0x9c1FfA8b0E7e2Ba37bBd5f1C5b7E8d9A1c2B3d4E", amount: "2400", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", decimals: 6, chain: "arb", confidentiality: "basic" },
  { key: "r2", recipient: "0x5A2bC7dE9f0132445aB8e6F1c2D3e4F5a6B7c8D9", amount: "1800", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", decimals: 6, chain: "base", confidentiality: "basic" },
  // Ends in "0": mock mode scripts this one to fail, so the retry path is demoable.
  { key: "r3", recipient: "0x3dD9aB1cE4f5027618293aBcDeF0123456789aB0", amount: "1200", assetId: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near", symbol: "USDT", decimals: 6, chain: "eth", confidentiality: "advanced" },
];

export default function PayrollPage() {
  const { account } = useWallet();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [rows, setRows] = useState<DraftRow[]>(DEFAULT_ROWS);
  const [runName, setRunName] = useState("Payroll run");
  const [originAsset, setOriginAsset] = useState(DEFAULT_ORIGIN_ASSET);
  const [dry, setDry] = useState(false);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { busy } = usePayrollRun();

  useEffect(() => {
    loadAssets().then((a) => {
      setAssets(a);
      if (a.length && !a.some((x) => x.assetId === originAsset)) setOriginAsset(a[0].assetId);
    });
    listRuns().then(setRuns).catch(() => {});
  }, []);

  const updateRow = (key: string, patch: Partial<DraftRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const validationErrors = rows.map(validateRow).filter(Boolean) as string[];

  async function onCreate() {
    setError(null);
    if (!account) return setError("Connect a wallet first — the run is signed by the employer account.");
    if (!rows.length) return setError("Add at least one payment.");
    if (validationErrors.length) return setError(validationErrors[0]);
    if (isLiveMode() && !dry) {
      // Guardrail: never spend without an explicit, separate confirmation screen.
      const ok = window.confirm(
        "Live mode: this run will ask your wallet to approve real deposits on NEAR mainnet. Continue to the review screen?",
      );
      if (!ok) return;
    }
    setCreating(true);
    try {
      const run = await buildRun();
      window.location.href = `/run/${run.id}?autostart=1${dry ? "&dry=1" : ""}`;
    } catch (e) {
      setError((e as Error).message);
      setCreating(false);
    }
  }

  async function buildRun(): Promise<PayrollRun> {
    if (!account) throw new Error("No account");
    const payments: Payment[] = rows.map((r, i) => ({
      id: `pay-${Date.now().toString(36)}-${i}${r.key.slice(0, 3)}`,
      recipient: r.recipient.trim(),
      assetId: r.assetId,
      symbol: r.symbol,
      amount: parseUnits(r.amount, r.decimals).toString(),
      decimals: r.decimals,
      chain: r.chain,
      status: "draft",
      confidentiality: r.confidentiality,
      createdAt: new Date().toISOString(),
    }));

    const run: PayrollRun = {
      id: `run-${Date.now().toString(36)}`,
      employer: account.accountId,
      name: runName || "Payroll run",
      createdAt: new Date().toISOString(),
      currency: "USD",
      payments,
      runKeyId: crypto.randomUUID(),
    };

    await createRun(run);
    return run;
  }

  return (
    <>
      <Head>
        <title>Payroll — Veilroll</title>
      </Head>

      <div className="between" style={{ margin: "2rem 0 1.25rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.25rem" }}>New payroll run</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Each row is one payment with its own receipt. Quotes are confidential where the provider
            allows it.
          </p>
        </div>
        <span className="pill">{isLiveMode() ? "live · 1Click" : "mock settlement"}</span>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="grid-2" style={{ marginBottom: "0.9rem" }}>
          <div className="field">
            <label htmlFor="runname">Run name</label>
            <input id="runname" value={runName} onChange={(e) => setRunName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="origin">Funded from (origin asset)</label>
            <select id="origin" value={originAsset} onChange={(e) => setOriginAsset(e.target.value)}>
              {(assets.length ? assets : []).map((a) => (
                <option key={a.assetId} value={a.assetId}>
                  {a.symbol} on {a.blockchain}
                </option>
              ))}
              {!assets.length && <option value={originAsset}>USDC on near</option>}
            </select>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: "38%" }}>Recipient address</th>
              <th className="num" style={{ width: "13%" }}>Amount</th>
              <th style={{ width: "24%" }}>Asset / chain</th>
              <th style={{ width: "17%" }}>Privacy</th>
              <th style={{ width: "8%" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <input
                    value={r.recipient}
                    placeholder="0x… or Solana address"
                    onChange={(e) => updateRow(r.key, { recipient: e.target.value })}
                    aria-label="Recipient address"
                  />
                </td>
                <td>
                  <input
                    className="num"
                    value={r.amount}
                    placeholder="0.00"
                    inputMode="decimal"
                    onChange={(e) => updateRow(r.key, { amount: e.target.value })}
                    aria-label="Amount"
                  />
                </td>
                <td>
                  <select
                    value={r.assetId}
                    aria-label="Asset and chain"
                    onChange={(e) => {
                      const a = assets.find((x) => x.assetId === e.target.value);
                      updateRow(r.key, {
                        assetId: e.target.value,
                        symbol: a?.symbol ?? r.symbol,
                        decimals: a?.decimals ?? r.decimals,
                        chain: a?.blockchain ?? r.chain,
                      });
                    }}
                  >
                    {(assets.length ? assets : [{ assetId: r.assetId, symbol: r.symbol, blockchain: r.chain } as Asset]).map(
                      (a) => (
                        <option key={a.assetId} value={a.assetId}>
                          {a.symbol} on {a.blockchain}
                        </option>
                      ),
                    )}
                  </select>
                </td>
                <td>
                  <select
                    value={r.confidentiality}
                    aria-label="Privacy level"
                    onChange={(e) =>
                      updateRow(r.key, { confidentiality: e.target.value as DraftRow["confidentiality"] })
                    }
                  >
                    <option value="basic">confidential · basic</option>
                    <option value="advanced">confidential · advanced</option>
                    <option value="public">public</option>
                  </select>
                </td>
                <td>
                  <button
                    className="ghost small danger"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    disabled={rows.length === 1}
                    aria-label="Remove row"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: "0.9rem" }}>
          <button
            className="ghost small"
            onClick={() =>
              setRows((rs) => [
                ...rs,
                emptyRow({
                  assetId: rs[0]?.assetId ?? "",
                  symbol: rs[0]?.symbol ?? "USDC",
                  decimals: rs[0]?.decimals ?? 6,
                  chain: rs[0]?.chain ?? "arb",
                }),
              ])
            }
          >
            + Add payment
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="between">
          <div className="stack" style={{ gap: "0.4rem" }}>
            <label className="row" style={{ margin: 0, gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={dry}
                onChange={(e) => setDry(e.target.checked)}
                style={{ width: "auto" }}
              />
              <span style={{ color: "var(--text)" }}>Dry run — quote only, never move funds</span>
            </label>
            <p className="tiny dim" style={{ margin: 0 }}>
              {dry
                ? "Each payment gets a real quote but no deposit address, so nothing can settle."
                : "Each payment will ask for wallet approval. Failures are tracked per payment."}
              {!isLiveMode() && " In mock mode a recipient ending in “0” is scripted to fail, so retry is demoable."}
            </p>
          </div>
          <button className="primary" onClick={onCreate} disabled={creating || busy || !account}>
            {creating ? "Creating…" : "Create run & quote"}
          </button>
        </div>
        {!account && (
          <p className="tiny warn" style={{ marginTop: "0.6rem", color: "var(--warn)" }}>
            Connect a wallet to create a run.
          </p>
        )}
        {error && (
          <div className="notice bad" style={{ marginTop: "0.75rem" }}>
            {error}
          </div>
        )}
      </div>

      {runs.length > 0 && (
        <>
          <h2 style={{ marginTop: "2rem" }}>Your runs</h2>
          <div className="panel">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Created</th>
                  <th className="num">Payments</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="muted small">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="num">{r.payments.length}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link href={`/run/${r.id}`} className="small">
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
