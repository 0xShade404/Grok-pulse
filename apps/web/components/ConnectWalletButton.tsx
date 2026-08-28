"use client";

import { useState } from "react";
import { Wallet, ChevronDown, LogOut, AlertTriangle } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { StatusIndicator } from "@/components/StatusIndicator";
import { POLYGON_CHAIN_ID } from "@/lib/wagmi/config";

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Non-custodial browser-wallet connect control (CLAUDE.md section 22-23).
 * Connecting here only lets this app read the wallet's address and later
 * ask it to sign things -- it never receives a private key. Disconnected ->
 * a single "Connect Wallet" action; connected -> the truncated address, a
 * wrong-chain warning + one-click switch if needed, and a disconnect
 * action.
 */
export function ConnectWalletButton() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);

  const wrongChain = isConnected && chainId !== POLYGON_CHAIN_ID;

  if (!isConnected) {
    const injectedConnector = connectors.find((c) => c.type === "injected") ?? connectors[0];
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!injectedConnector || isPending}
        onClick={() => injectedConnector && connect({ connector: injectedConnector })}
      >
        <Wallet className="size-3.5" aria-hidden />
        {isPending ? "Connecting..." : "Connect Wallet"}
      </Button>
    );
  }

  if (wrongChain) {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={isSwitching}
        onClick={() => switchChain({ chainId: POLYGON_CHAIN_ID })}
      >
        <AlertTriangle className="size-3.5" aria-hidden />
        {isSwitching ? "Switching..." : "Switch to Polygon"}
      </Button>
    );
  }

  return (
    <div className="relative">
      <Button type="button" variant="outline" size="sm" onClick={() => setMenuOpen((v) => !v)}>
        <StatusIndicator state="CONNECTED" label="" className="px-1" />
        <span className="tabular-nums">{truncateAddress(address ?? "")}</span>
        <ChevronDown className="size-3.5" aria-hidden />
      </Button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-md border border-border-strong bg-panel p-1 shadow-xl">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ink-dim hover:bg-panel-2 hover:text-ink"
            onClick={() => {
              disconnect();
              setMenuOpen(false);
            }}
          >
            <LogOut className="size-3.5" aria-hidden />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
