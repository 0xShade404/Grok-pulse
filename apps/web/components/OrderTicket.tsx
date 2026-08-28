"use client";

import { useState } from "react";
import Link from "next/link";
import { useWalletClient } from "wagmi";
import type { TradingRestriction } from "@/lib/calc/countdown";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusIndicator } from "@/components/StatusIndicator";
import { useOrderStore } from "@/lib/stores/orderStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useAuthStore } from "@/lib/stores/authStore";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { submitLiveTrade, type LiveTradeResult } from "@/lib/live-order";
import { cn } from "@/lib/utils";

/**
 * Order panel (CLAUDE.md section 5-6). "PAPER TRADE" writes a locally
 * simulated, clearly-mock order into the order store (Phase 1 has no paper
 * execution adapter here yet -- that is a separate build). "LIVE TRADE" is
 * now wired end to end (CLAUDE.md section 22): logged in -> verified wallet
 * -> live trading enabled -> prepare/sign/submit, matching every gate the
 * spec requires before real funds move. All of that orchestration lives in
 * `lib/live-order.ts`, not here (CLAUDE.md section 84 point 10) -- this
 * component only reads state, renders it, and calls `submitLiveTrade`.
 */

type LiveTicketState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "done"; result: LiveTradeResult };

export function OrderTicket({
  marketId,
  suggestedPrice,
  restriction,
}: {
  marketId: string;
  suggestedPrice?: number;
  restriction: TradingRestriction;
}) {
  const side = useTerminalStore((s) => s.orderTicketSide);
  const setSide = useTerminalStore((s) => s.setOrderTicketSide);
  const upsertOrder = useOrderStore((s) => s.upsertOrder);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const walletVerified = useAuthStore((s) => s.wallet?.verified ?? false);
  const liveTradingEnabled = useAuthStore((s) => s.liveTradingEnabled);
  const killSwitchEngaged = useSettingsStore((s) => s.killSwitchEngaged);
  const setKillSwitchEngaged = useSettingsStore((s) => s.setKillSwitchEngaged);
  const maxOrderUsd = useSettingsStore((s) => s.maxOrderUsd);
  const dailyTradeLimit = useSettingsStore((s) => s.dailyTradeLimit);
  const requireLiveConfirmation = useSettingsStore((s) => s.requireLiveConfirmation);
  const { data: walletClient } = useWalletClient();

  const [price, setPrice] = useState(suggestedPrice?.toFixed(2) ?? "0.50");
  const [size, setSize] = useState("10");
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);
  const [liveState, setLiveState] = useState<LiveTicketState>({ phase: "idle" });

  const entryDisabled = restriction === "ENTRY_DISABLED" || restriction === "CANCEL_RESTING_ORDERS" || restriction === "STOPPED";
  const numericPrice = Number(price);
  const numericSize = Number(size);
  const orderValuesValid = Number.isFinite(numericPrice) && numericPrice > 0 && numericPrice < 1 && Number.isFinite(numericSize) && numericSize > 0;
  const clientRiskReason = !orderValuesValid
    ? "Enter a price between 0 and 1 and a positive USD size."
    : numericSize > maxOrderUsd
      ? `Order exceeds your $${maxOrderUsd} client limit.`
      : null;

  function submitPaperOrder() {
    const id = `mock_order_${Date.now()}`;
    upsertOrder({
      id,
      userId: "demo-user",
      marketId,
      clientOrderId: id,
      exchangeOrderId: null,
      mode: "PAPER",
      side,
      price: Number(price),
      sizeUsd: Number(size),
      status: "filled",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setLastSubmitted(`Simulated paper ${side} order for $${size} @ ${price} (mock -- no backend).`);
  }

  // Each of these gates is checked in the order the CLAUDE.md section 22
  // flow establishes them: log in, then link+verify a wallet, then enable
  // live trading. Whichever gate fails first is what the tooltip explains --
  // there's no point telling someone to enable live trading before they've
  // even linked a wallet.
  const liveDisabledReason: string | null = !isAuthenticated
    ? "Log in to trade live."
    : !walletVerified
      ? "Link and verify a wallet on your account page to trade live."
        : !liveTradingEnabled
          ? "Enable live trading on your account page to trade live."
          : killSwitchEngaged
            ? "Emergency stop is engaged. Disable it only after reviewing open risk."
            : clientRiskReason
              ? clientRiskReason
              : entryDisabled
                ? "New entries are disabled this close to market close."
                : liveState.phase === "submitting"
                  ? "Order in progress..."
                  : null;

  const liveReady = liveDisabledReason === null;

  async function handleLiveTrade() {
    if (!liveReady || !walletClient) {
      if (!walletClient) {
        setLiveState({
          phase: "done",
          result: { status: "SIGNING_FAILED", message: "No wallet connected. Reconnect your wallet and try again." },
        });
      }
      return;
    }
    if (requireLiveConfirmation && !window.confirm(`Submit LIVE ${side} order for $${numericSize.toFixed(2)} at ${numericPrice.toFixed(2)}? This will request a wallet signature.`)) {
      return;
    }
    if (liveState.phase === "submitting") return;
    setLiveState({ phase: "submitting" });
    const result = await submitLiveTrade({
      marketId,
      side,
      price: numericPrice,
      sizeUsd: numericSize,
      walletClient,
    });
    setLiveState({ phase: "done", result });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-1.5">
        <Button
          type="button"
          variant={side === "YES" ? "buy" : "outline"}
          onClick={() => setSide("YES")}
        >
          YES
        </Button>
        <Button
          type="button"
          variant={side === "NO" ? "sell" : "outline"}
          onClick={() => setSide("NO")}
        >
          NO
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="order-price">Price</Label>
          <Input
            id="order-price"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="order-size">Size (USD)</Label>
          <Input
            id="order-size"
            inputMode="decimal"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
        </div>
      </div>

      {(entryDisabled || clientRiskReason) && (
        <p className="flex items-center gap-1.5 text-[11px] text-warn" role="alert">
          <Info className="size-3.5 shrink-0" aria-hidden />
          {clientRiskReason ?? "New entries are disabled this close to market close."}
        </p>
      )}

      <p className="text-[10px] text-ink-faint">Client guardrails: max ${maxOrderUsd} per order · {dailyTradeLimit} trades/day · confirmation required</p>

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant={killSwitchEngaged ? "destructive" : "outline"}
          aria-pressed={killSwitchEngaged}
          onClick={() => setKillSwitchEngaged(!killSwitchEngaged)}
          className="min-h-11"
        >
          {killSwitchEngaged ? "EMERGENCY STOP ENGAGED" : "ENGAGE EMERGENCY STOP"}
        </Button>
        <Button
          type="button"
          variant={side === "YES" ? "buy" : "sell"}
          disabled={entryDisabled || !orderValuesValid}
          onClick={submitPaperOrder}
        >
          PAPER TRADE
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block w-full">
              <Button
                type="button"
                variant="destructive"
                disabled={!liveReady}
                className={cn("w-full", !liveReady && "opacity-50")}
                onClick={handleLiveTrade}
              >
                {liveState.phase === "submitting" ? "SUBMITTING..." : "LIVE TRADE"}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {liveDisabledReason ?? "Submits a real order signed by your connected wallet."}
          </TooltipContent>
        </Tooltip>

        {!isAuthenticated && (
          <p className="text-center text-[10px] text-ink-faint">
            <Link href="/login" className="text-accent hover:underline">
              Log in
            </Link>{" "}
            or{" "}
            <Link href="/signup" className="text-accent hover:underline">
              sign up
            </Link>{" "}
            to trade live.
          </p>
        )}
        {isAuthenticated && (!walletVerified || !liveTradingEnabled) && (
          <p className="text-center text-[10px] text-ink-faint">
            <Link href="/account" className="text-accent hover:underline">
              Set up live trading
            </Link>{" "}
            in your account.
          </p>
        )}
      </div>

      {liveState.phase === "done" && <LiveResultBanner result={liveState.result} />}

      {lastSubmitted && (
        <p className={cn("text-[11px] text-ink-faint")}>{lastSubmitted}</p>
      )}
    </div>
  );
}

function LiveResultBanner({ result }: { result: LiveTradeResult }) {
  switch (result.status) {
    case "SUBMITTED":
      return (
        <div className="flex flex-col gap-1 rounded border border-border bg-panel-2 p-2 text-[11px]">
          <StatusIndicator state="ORDER_PENDING" label={result.response.status.toUpperCase()} />
          <span className="text-ink-faint">
            Order {result.response.orderId} submitted. This confirms submission only --
            never assume a fill until the order status updates.
          </span>
        </div>
      );
    case "SIGNATURE_DECLINED":
      return (
        <div className="flex flex-col gap-1 rounded border border-border bg-panel-2 p-2 text-[11px]">
          <StatusIndicator state="CANCELLED" label="SIGNATURE DECLINED" />
          <span className="text-ink-faint">You declined the wallet signature. No order was placed -- you can try again.</span>
        </div>
      );
    case "PREPARE_EXPIRED":
      return (
        <div className="flex flex-col gap-1 rounded border border-border bg-panel-2 p-2 text-[11px]">
          <StatusIndicator state="CANCELLED" label="EXPIRED" />
          <span className="text-ink-faint">This order preparation expired before it could be submitted. Try again.</span>
        </div>
      );
    case "WALLET_MISMATCH":
      return (
        <div className="flex flex-col gap-1 rounded border border-border bg-panel-2 p-2 text-[11px]">
          <StatusIndicator state="REJECTED" label="WALLET MISMATCH" />
          <span className="text-ink-faint">
            Connected wallet ({result.connected}) does not match your linked wallet ({result.expected}).
          </span>
        </div>
      );
    case "PREPARE_REJECTED":
      return (
        <div className="flex flex-col gap-1 rounded border border-border bg-panel-2 p-2 text-[11px]">
          <StatusIndicator state="REJECTED" label="RISK REJECTED" />
          <span className="text-ink-faint">{result.reason}</span>
        </div>
      );
    case "SIGNING_FAILED":
    case "SUBMIT_FAILED":
      return (
        <div className="flex flex-col gap-1 rounded border border-border bg-panel-2 p-2 text-[11px]">
          <StatusIndicator state="REJECTED" label="FAILED" />
          <span className="text-ink-faint">{result.message}</span>
        </div>
      );
  }
}
