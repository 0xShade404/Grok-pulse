"use client";

import { useState } from "react";
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
import { useOrderStore } from "@/lib/stores/orderStore";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { cn } from "@/lib/utils";

/**
 * Order panel (CLAUDE.md section 5-6). Phase 1 has no order manager --
 * "PAPER TRADE" only writes a locally-simulated, clearly mock order into
 * the order store, and "LIVE TRADE" is permanently disabled with an
 * explanatory tooltip (CLAUDE.md section 22, 90-91: live trading requires
 * explicit, server-authoritative activation this build does not have).
 */
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
  const liveTradingEnabled = useSettingsStore((s) => s.liveTradingEnabled);

  const [price, setPrice] = useState(suggestedPrice?.toFixed(2) ?? "0.50");
  const [size, setSize] = useState("10");
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);

  const entryDisabled = restriction === "ENTRY_DISABLED" || restriction === "CANCEL_RESTING_ORDERS" || restriction === "STOPPED";

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

      {entryDisabled && (
        <p className="flex items-center gap-1.5 text-[11px] text-warn">
          <Info className="size-3.5 shrink-0" aria-hidden />
          New entries are disabled this close to market close.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant={side === "YES" ? "buy" : "sell"}
          disabled={entryDisabled}
          onClick={submitPaperOrder}
        >
          PAPER TRADE
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block w-full">
              <Button type="button" variant="destructive" disabled className="w-full opacity-50">
                LIVE TRADE
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {liveTradingEnabled
              ? "Live trading disabled for this market."
              : "Live trading disabled. GrokPulse is in Phase 1 (read-only terminal) -- no wallet, signing, or execution backend exists yet."}
          </TooltipContent>
        </Tooltip>
      </div>

      {lastSubmitted && (
        <p className={cn("text-[11px] text-ink-faint")}>{lastSubmitted}</p>
      )}
    </div>
  );
}
