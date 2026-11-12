/**
 * Wallet context: exposes the connected account + wallet to every page.
 *
 * Two paths:
 *   - real wallet via @hot-labs/near-connect
 *   - a local demo account (mock mode only) so the flow works with no extension
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  connectWallet,
  disconnectWallet,
  restoreSession,
  type Account,
  type NearWalletBase,
} from "@/lib/near";
import {
  DEMO_ACCOUNT,
  demoEnabled,
  demoSignature,
  disableDemo,
  enableDemo,
} from "@/lib/demoWallet";
import { isLiveMode } from "@/core/settlement";

interface WalletState {
  account: Account | null;
  wallet: NearWalletBase | null;
  ready: boolean;
  connecting: boolean;
  error: string | null;
  isDemo: boolean;
  connect: () => Promise<void>;
  connectDemo: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** NEP-413 sign, routed to the demo stub when in demo mode. */
  signMessage: (message: string, nonce: Uint8Array) => Promise<import("@/core/types").SignedMessage>;
}

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [wallet, setWallet] = useState<NearWalletBase | null>(null);
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (demoEnabled() && !isLiveMode()) {
        if (alive) {
          setAccount({ accountId: DEMO_ACCOUNT });
          setIsDemo(true);
        }
        setReady(true);
        return;
      }
      try {
        const session = await restoreSession();
        if (alive && session) {
          setWallet(session.wallet);
          setAccount(session.account);
        }
      } catch {
        /* no session */
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { wallet: w, account: a } = await connectWallet();
      setWallet(w);
      setAccount(a);
      setIsDemo(false);
    } catch (e) {
      setError((e as Error).message || "Could not connect wallet");
    } finally {
      setConnecting(false);
    }
  }, []);

  const connectDemo = useCallback(async () => {
    if (isLiveMode()) throw new Error("The demo account cannot be used in live mode.");
    enableDemo();
    setAccount({ accountId: DEMO_ACCOUNT });
    setWallet(null);
    setIsDemo(true);
  }, []);

  const disconnect = useCallback(async () => {
    disableDemo();
    await disconnectWallet();
    setWallet(null);
    setAccount(null);
    setIsDemo(false);
  }, []);

  const signMessage = useCallback(
    async (message: string, nonce: Uint8Array) => {
      if (isDemo) return demoSignature();
      if (!wallet || !account) throw new Error("Connect a wallet to sign.");
      const { signNep413 } = await import("@/lib/near");
      return signNep413(wallet, account.accountId, message, nonce);
    },
    [isDemo, wallet, account],
  );

  const value = useMemo<WalletState>(
    () => ({
      account,
      wallet,
      ready,
      connecting,
      error,
      isDemo,
      connect,
      connectDemo,
      disconnect,
      signMessage,
    }),
    [account, wallet, ready, connecting, error, isDemo, connect, connectDemo, disconnect, signMessage],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
