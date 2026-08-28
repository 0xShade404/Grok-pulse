"use client";

import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/StatusIndicator";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { requestWalletLinkChallenge, verifyWalletLink } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/stores/authStore";

/**
 * SIWE-style wallet linking (CLAUDE.md section 22-23): connect -> challenge
 * -> sign -> verify. The signature proves ownership of the address without
 * this app ever holding a key -- the wallet extension signs the exact
 * message text the server issued, and the server re-derives/compares it.
 */
export function WalletLinkPanel() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const wallet = useAuthStore((s) => s.wallet);
  const setWallet = useAuthStore((s) => s.setWallet);

  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyLinkedThisAddress =
    wallet?.verified && address && wallet.address.toLowerCase() === address.toLowerCase();

  async function handleLink() {
    if (!address) return;
    setError(null);
    setLinking(true);
    try {
      const challenge = await requestWalletLinkChallenge({ address });
      let signature: string;
      try {
        signature = await signMessageAsync({ message: challenge.message });
      } catch {
        // The wallet's signature prompt was declined/closed -- a normal,
        // recoverable outcome, not a crash (CLAUDE.md section 22 flow must
        // handle this gracefully).
        setError("Signature request was declined. You can try again.");
        return;
      }
      const result = await verifyWalletLink({ address, signature });
      setWallet({ address: result.address, verified: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet verification failed.");
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-dim">Browser wallet</span>
        <ConnectWalletButton />
      </div>

      <div className="flex items-center justify-between gap-2 rounded border border-border bg-panel-2 p-2.5">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-ink-dim">Linked wallet</span>
          {wallet ? (
            <span className="num text-xs text-ink">{wallet.address}</span>
          ) : (
            <span className="text-xs text-ink-faint">No wallet linked yet.</span>
          )}
        </div>
        {wallet?.verified ? (
          <StatusIndicator state="LOW_RISK" label="VERIFIED" />
        ) : wallet ? (
          <StatusIndicator state="MEDIUM_RISK" label="UNVERIFIED" />
        ) : (
          <StatusIndicator state="DISCONNECTED" label="NONE" />
        )}
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-danger">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        disabled={!isConnected || linking || Boolean(alreadyLinkedThisAddress)}
        onClick={handleLink}
      >
        <ShieldCheck className="size-4" aria-hidden />
        {alreadyLinkedThisAddress
          ? "This wallet is linked"
          : linking
            ? "Waiting for signature..."
            : "Link Wallet"}
      </Button>
      {!isConnected && (
        <p className="text-[11px] text-ink-faint">Connect a wallet above before linking it.</p>
      )}
    </div>
  );
}
