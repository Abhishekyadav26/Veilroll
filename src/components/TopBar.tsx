import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/router";
import { useWallet } from "./WalletProvider";
import { isLiveMode } from "@/core/settlement";

function shortId(id: string): string {
  if (id.length <= 22) return id;
  return `${id.slice(0, 10)}…${id.slice(-6)}`;
}

export function TopBar() {
  const { account, connect, connectDemo, disconnect, connecting, ready, isDemo } = useWallet();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="topbar">
      <div className="shell topbar-inner">
        <Link href="/" className="brand">
          <span className="dot" />
          Veilroll
        </Link>
        <nav className="nav grow">
          <Link href="/payroll">Payroll</Link>
          <Link href="/auditor">Auditor</Link>
          <Link href="/demo">Demo guide</Link>
        </nav>
        {account ? (
          <div className="row">
            <span className={`pill ${isDemo ? "warn" : "info"} mono-sm`} title={account.accountId}>
              {isDemo ? "demo · " : ""}
              {shortId(account.accountId)}
            </span>
            <button
              className="ghost small"
              onClick={async () => {
                await disconnect();
                if (router.pathname !== "/") router.push("/");
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="row" style={{ position: "relative" }}>
            <button
              className="primary small"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={!ready || connecting}
            >
              {connecting ? "Connecting…" : ready ? "Connect wallet" : "Loading…"}
            </button>
            {menuOpen && ready && (
              <div className="panel" style={{ position: "absolute", right: 0, top: "2.4rem", zIndex: 60, minWidth: "15rem", padding: "0.6rem" }}>
                <button
                  className="small"
                  style={{ width: "100%", marginBottom: "0.4rem" }}
                  onClick={async () => {
                    setMenuOpen(false);
                    await connect();
                  }}
                >
                  NEAR wallet
                </button>
                {!isLiveMode() && (
                  <button
                    className="ghost small"
                    style={{ width: "100%" }}
                    onClick={async () => {
                      setMenuOpen(false);
                      await connectDemo();
                    }}
                  >
                    Use demo account (no wallet)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
