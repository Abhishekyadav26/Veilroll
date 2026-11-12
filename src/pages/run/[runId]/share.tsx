import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@/components/WalletProvider";
import { formatUnits } from "@/core/money";
import {
  describeScope,
  encodeShareToken,
  prepareShare,
  signShare,
} from "@/core/share";
import type { PayrollRun, Receipt, ShareScope } from "@/core/types";
import { loadRun, getEncryptedReceipts } from "@/lib/store";

const EXPIRY_OPTIONS = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
];

export default function SharePage() {
  const router = useRouter();
  const runId = typeof router.query.runId === "string" ? router.query.runId : "";
  const { account, wallet, isDemo, signMessage } = useWallet();

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [runKey, setRunKey] = useState<CryptoKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [scopeKind, setScopeKind] = useState<ShareScope["kind"]>("run");
  const [paymentId, setPaymentId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expiryMs, setExpiryMs] = useState(EXPIRY_OPTIONS[1].ms);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) return;
    loadRun(runId)
      .then((b) => {
        if (!b) return setError("Run not found in this browser.");
        setRun(b.run);
        setReceipts(b.receipts);
        setRunKey(b.runKey);
        if (b.receipts[0]) setPaymentId(b.receipts[0].paymentId);
        const dates = b.receipts.map((r) => r.date).sort();
        if (dates.length) {
          setFrom(dates[0].slice(0, 10));
          setTo(dates[dates.length - 1].slice(0, 10));
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [runId]);

  const scope: ShareScope = useMemo(() => {
    if (scopeKind === "run") return { kind: "run" };
    if (scopeKind === "payment") return { kind: "payment", paymentId };
    return { kind: "range", from, to };
  }, [scopeKind, paymentId, from, to]);

  const inScope = useMemo(() => {
    if (!scope) return [];
    // Local preview of what the auditor will see.
    return receipts.filter((r) => {
      if (scope.kind === "run") return true;
      if (scope.kind === "payment") return r.paymentId === scope.paymentId;
      const d = Date.parse(r.date);
      return d >= Date.parse(scope.from) && d <= Date.parse(scope.to) + 86399999;
    });
  }, [receipts, scope]);

  async function onCreate() {
    setError(null);
    if (!run || !runKey || !account) {
      return setError("Connect a wallet (or the demo account) to sign this share.");
    }
    if (account.accountId !== run.employer) {
      return setError(`Only ${run.employer} can sign shares for this run.`);
    }
    if (scopeKind === "payment" && !paymentId) return setError("Choose a payment.");
    if (scopeKind === "range" && (!from || !to)) return setError("Choose a date range.");
    if (scopeKind === "range" && Date.parse(to) < Date.parse(from)) {
      return setError("The end date is before the start date.");
    }
    if (inScope.length === 0) {
      return setError("That scope matches no receipts. The auditor would see nothing.");
    }

    const blob = getEncryptedReceipts(run.id);
    if (!blob?.data) return setError("No encrypted receipts stored for this run yet.");

    setBusy(true);
    try {
      const expiresAt = new Date(Date.now() + expiryMs).toISOString();
      const prepared = await prepareShare({ run, runKey, scope, expiresAt, receiptsBlob: blob });

      // NEP-413: the employer signs the exact share payload.
      const signed = await signMessage(prepared.signRequest.message, prepared.signRequest.nonce);
      const finalShare = signShare(prepared, signed);

      const token = encodeShareToken(finalShare.token);
      const url = `${window.location.origin}/auditor#k=${token}`;
      setLink(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !run) {
    return (
      <div className="panel" style={{ marginTop: "2rem" }}>
        <h2>Cannot open this run</h2>
        <p className="muted">{error}</p>
      </div>
    );
  }

  if (!run) return <p className="muted" style={{ marginTop: "2rem" }}>Loading…</p>;

  return (
    <>
      <Head>
        <title>Create auditor share — Veilroll</title>
      </Head>

      <p className="small muted" style={{ marginTop: "1.5rem" }}>
        <Link href={`/run/${run.id}`}>← {run.name}</Link>
      </p>
      <h1>Create an auditor share</h1>
      <p className="muted" style={{ maxWidth: "62ch" }}>
        The auditor gets a link that decrypts only what you choose, expires when you say, and carries
        your NEP-413 signature so they can attribute it back to {run.employer}.
      </p>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h2>What do they see?</h2>
        <div className="row" style={{ marginBottom: "0.9rem" }}>
          {(["run", "payment", "range"] as const).map((k) => (
            <button
              key={k}
              className={scopeKind === k ? "primary small" : "ghost small"}
              onClick={() => setScopeKind(k)}
            >
              {k === "run" ? "Whole run" : k === "payment" ? "One payment" : "Date range"}
            </button>
          ))}
        </div>

        {scopeKind === "payment" && (
          <div className="field" style={{ maxWidth: "34rem" }}>
            <label htmlFor="pmt">Payment</label>
            <select id="pmt" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
              {receipts.map((r) => (
                <option key={r.paymentId} value={r.paymentId}>
                  {new Date(r.date).toLocaleDateString()} · {formatUnits(r.amount, r.decimals)} {r.symbol} →{" "}
                  {r.recipient.slice(0, 10)}…
                </option>
              ))}
              {!receipts.length && <option value="">No receipts yet</option>}
            </select>
          </div>
        )}

        {scopeKind === "range" && (
          <div className="grid-2" style={{ maxWidth: "34rem" }}>
            <div className="field">
              <label htmlFor="from">From</label>
              <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="to">To</label>
              <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}

        <hr />

        <div className="between">
          <div>
            <div className="small">
              <b>{describeScope(scope)}</b>
            </div>
            <div className="tiny muted">
              {inScope.length} of {receipts.length} receipts will be visible
            </div>
          </div>
          <div className="field" style={{ maxWidth: "12rem" }}>
            <label htmlFor="exp">Expires in</label>
            <select id="exp" value={expiryMs} onChange={(e) => setExpiryMs(Number(e.target.value))}>
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.ms} value={o.ms}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="notice bad" style={{ marginBottom: "1rem" }}>{error}</div>}

      <div className="panel">
        <div className="between">
          <p className="small muted" style={{ margin: 0 }}>
            Signing with <b>{account?.accountId ?? "—"}</b>
            {isDemo ? " (demo account — signature is a placeholder and will show as unverified)" : " (NEP-413, no transaction, no gas)"}.
          </p>
          <button className="primary" onClick={onCreate} disabled={busy || !account}>
            {busy ? "Signing…" : "Sign & create link"}
          </button>
        </div>

        {link && (
          <div className="stack" style={{ marginTop: "1rem" }}>
            <div className="notice good">
              Share created. The link holds the key material in the URL <b>fragment</b> (<code>#k=…</code>),
              which browsers never send to a server.
            </div>
            <div className="linkbox">{link}</div>
            <div className="row">
              <button
                className="small"
                onClick={() => navigator.clipboard.writeText(link)}
              >
                Copy link
              </button>
              <a className="btn small" href={link} target="_blank" rel="noreferrer">
                Open as auditor →
              </a>
            </div>
            <p className="tiny dim" style={{ margin: 0 }}>
              Anyone with this link can read the {inScope.length} receipt(s) in scope until{" "}
              {new Date(Date.now() + expiryMs).toLocaleString()}.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
