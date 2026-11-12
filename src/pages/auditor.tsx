import Head from "next/head";
import { useCallback, useEffect, useState } from "react";
import { CSV_HEADER, receiptsToCsv, downloadCsv } from "@/core/csv";
import { formatUnits } from "@/core/money";
import { decodeShareToken, describeScope, isExpired, openShare, filterByScope } from "@/core/share";
import type { ChainVerification, Receipt, ShareToken } from "@/core/types";
import { getProvider } from "@/core/settlement";
import { signatureIsPresent, verifyShareSignature, networkLabel, type SignatureCheck } from "@/lib/nep413";

type Phase = "idle" | "opening" | "ready" | "error";

export default function AuditorPage() {
  const [token, setToken] = useState<ShareToken | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<SignatureCheck | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifications, setVerifications] = useState<Record<string, ChainVerification>>({});
  const [pasted, setPasted] = useState("");

  const load = useCallback(async (raw: string) => {
    setPhase("opening");
    setError(null);
    // Reset everything so a second share never inherits the first one's state.
    setToken(null);
    setReceipts([]);
    setSig(null);
    setVerifications({});
    try {
      const t = decodeShareToken(raw);
      setToken(t);

      if (isExpired(t)) {
        setPhase("error");
        setError(
          `This auditor link expired on ${new Date(t.expiresAt).toLocaleString()}. Ask the employer for a new one.`,
        );
        return;
      }

      if (!signatureIsPresent(t)) {
        setPhase("error");
        setError("This share carries no employer signature, so it cannot be trusted.");
        return;
      }

      const opened = await openShare(t);
      setReceipts(opened);
      setPhase("ready");

      // Verify the employer's signature in the background.
      setVerifying(true);
      verifyShareSignature(t)
        .then(setSig)
        .finally(() => setVerifying(false));
    } catch (e) {
      setPhase("error");
      setError((e as Error).message);
    }
  }, []);

  // Read the token from the URL fragment: #k=<token>.
  // Also listen for hashchange: moving from one share link to another is a
  // same-document navigation, so a mount-only effect would show stale data.
  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash;
      const match = hash.match(/(?:^#|&)k=([^&]+)/);
      if (match) load(decodeURIComponent(match[1]));
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [load]);

  async function verifyAll() {
    if (!token) return;
    const provider = getProvider();
    const out: Record<string, ChainVerification> = { ...verifications };
    for (const r of receipts) {
      out[r.paymentId] = await provider.verify(r);
      setVerifications({ ...out });
    }
  }

  function exportCsv() {
    if (!token) return;
    const csv = receiptsToCsv(receipts);
    downloadCsv(`${token.runId}-audit-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  // ---------------------------------------------------------------- idle state
  if (phase === "idle") {
    return (
      <>
        <Head>
          <title>Auditor — Veilroll</title>
        </Head>
        <h1 style={{ marginTop: "2rem" }}>Auditor view</h1>
        <p className="muted" style={{ maxWidth: "62ch" }}>
          Open the link your client gave you. Keys travel in the link fragment and are used only in
          this browser tab: nothing is sent to a server.
        </p>
        <div className="panel">
          <div className="field">
            <label htmlFor="paste">Paste an auditor link or share token</label>
            <textarea
              id="paste"
              rows={4}
              placeholder="https://…/auditor#k=…"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
          </div>
          <div className="row" style={{ marginTop: "0.75rem" }}>
            <button
              className="primary"
              onClick={() => {
                const raw = pasted.trim();
                const m = raw.match(/#k=([^&\s]+)/) ?? raw.match(/^([A-Za-z0-9_-]{40,})$/);
                if (!m) return setError("That does not look like a Veilroll auditor link.");
                load(decodeURIComponent(m[1]));
              }}
              disabled={!pasted.trim()}
            >
              Open
            </button>
          </div>
          {error && <div className="notice bad" style={{ marginTop: "0.75rem" }}>{error}</div>}
        </div>
      </>
    );
  }

  if (phase === "opening") return <p className="muted" style={{ marginTop: "2rem" }}>Decrypting…</p>;

  if (phase === "error") {
    return (
      <>
        <Head>
          <title>Auditor — Veilroll</title>
        </Head>
        <h1 style={{ marginTop: "2rem" }}>Cannot open this share</h1>
        <div className="notice bad">{error}</div>
        <p className="small muted" style={{ marginTop: "1rem" }}>
          Nothing was decrypted. If the link expired, ask the employer to create a new one.
        </p>
      </>
    );
  }

  const verifiedCount = Object.values(verifications).filter((v) => v.verified).length;

  return (
    <>
      <Head>
        <title>Auditor — Veilroll</title>
      </Head>

      <div className="between" style={{ margin: "2rem 0 1rem" }}>
        <div>
          <h1 style={{ marginBottom: "0.2rem" }}>Auditor view</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Run <span className="mono">{token?.runId}</span> · employer{" "}
            <span className="mono">{token?.employer}</span> · {networkLabel()}
          </p>
        </div>
        <div className="row">
          <span className="pill good">{receipts.length} receipts decrypted</span>
          <span className="pill">{describeScope(token!.scope)}</span>
        </div>
      </div>

      {/* Trust panel: state exactly what was and was not verified. */}
      <div className="panel" style={{ marginBottom: "1rem" }}>
        <h2>Who authorised this disclosure</h2>
        <table>
          <tbody>
            <tr>
              <td style={{ width: "34%" }} className="small muted">Employer account</td>
              <td className="mono-sm">{token?.employer}</td>
            </tr>
            <tr>
              <td className="small muted">Scope</td>
              <td className="small">{describeScope(token!.scope)}</td>
            </tr>
            <tr>
              <td className="small muted">Expires</td>
              <td className="small">
                {new Date(token!.expiresAt).toLocaleString()}{" "}
                {isExpired(token!) && <span className="pill bad">expired</span>}
              </td>
            </tr>
            <tr>
              <td className="small muted">Signature (NEP-413)</td>
              <td>
                {verifying ? (
                  <span className="pill warn">verifying…</span>
                ) : sig?.ok ? (
                  <span className="pill good">valid — signed by {sig.signerAccountId}</span>
                ) : (
                  <span className="pill bad">could not verify</span>
                )}
                {sig && !sig.ok && sig.reason && <div className="tiny dim" style={{ marginTop: "0.3rem" }}>{sig.reason}</div>}
                {sig?.ok && (
                  <div className="tiny dim" style={{ marginTop: "0.3rem" }}>
                    key {sig.signerPublicKey}
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="tiny dim" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
          Verification is a public RPC lookup of the signing key on the account ({networkLabel()}). It
          proves the account signed <i>this scope and expiry</i>; it does not prove the recipient was
          paid — that is what the settlement check below is for.
        </p>
      </div>

      <div className="panel" style={{ marginBottom: "1rem" }}>
        <div className="between">
          <h2 style={{ margin: 0 }}>Receipts</h2>
          <div className="row">
            <button className="small" onClick={verifyAll}>
              Check settlement on chain
            </button>
            <button className="primary small" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
        </div>
        {Object.keys(verifications).length > 0 && (
          <p className="tiny muted" style={{ marginTop: "0.5rem" }}>
            {verifiedCount} of {receipts.length} independently confirmed.
          </p>
        )}

        <table style={{ marginTop: "0.6rem" }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Recipient</th>
              <th className="num">Amount</th>
              <th>Chain</th>
              <th>Status</th>
              <th>Settlement</th>
              <th>Independent check</th>
            </tr>
          </thead>
          <tbody>
            {receipts.map((r) => {
              const v = verifications[r.paymentId];
              return (
                <tr key={r.paymentId}>
                  <td className="small muted">{new Date(r.date).toLocaleDateString()}</td>
                  <td className="mono-sm">{r.recipient}</td>
                  <td className="num">
                    {formatUnits(r.amount, r.decimals)} {r.symbol}
                  </td>
                  <td className="small">{r.chain}</td>
                  <td>
                    <span className={`pill ${r.status === "settled" ? "good" : "bad"}`}>{r.status}</span>
                  </td>
                  <td className="mono-sm">
                    {r.explorerUrl ? (
                      <a href={r.explorerUrl} target="_blank" rel="noreferrer">
                        {r.settlementReference?.slice(0, 12)}…
                      </a>
                    ) : (
                      r.settlementReference?.slice(0, 14) ?? "—"
                    )}
                  </td>
                  <td>
                    {!v ? (
                      <span className="dim small">not checked</span>
                    ) : v.verified ? (
                      <span className="pill good">{v.method}</span>
                    ) : (
                      <span className="pill warn" title={v.note}>
                        {v.method === "none" ? "no public check" : "unconfirmed"}
                      </span>
                    )}
                    {v?.note && <div className="tiny dim">{v.note}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="notice">
        <b>What the CSV contains.</b> The same columns you see: {CSV_HEADER.length} fields including the
        settlement reference, so a third party can re-check each row. Nothing outside the share scope is
        included, and the run&apos;s other receipts were never decrypted for you.
      </div>
    </>
  );
}
