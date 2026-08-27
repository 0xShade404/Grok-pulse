"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, Ban, CheckCircle2, Square, XCircle } from "lucide-react";
import type { MarketCountdown } from "@grokpulse/types";
import {
  interpolateSecondsRemaining,
  RESTRICTION_LABEL,
  type TradingRestriction,
} from "@/lib/calc/countdown";
import { formatTimeRemaining } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

const TIER_STYLE: Record<TradingRestriction, { icon: LucideIcon; className: string }> = {
  NORMAL: { icon: CheckCircle2, className: "border-ok/40 bg-ok-soft text-ok" },
  RESTRICTED_ENTRY: { icon: AlertTriangle, className: "border-warn/50 bg-warn-soft text-warn" },
  ENTRY_DISABLED: { icon: Ban, className: "border-warn/50 bg-warn-soft text-warn" },
  CANCEL_RESTING_ORDERS: { icon: XCircle, className: "border-danger/50 bg-danger-soft text-danger" },
  STOPPED: { icon: Square, className: "border-danger/50 bg-danger-soft text-danger" },
};

/**
 * Displays a server-authoritative countdown (CLAUDE.md section 6, 45).
 *
 * `countdown` must come from the backend (via TanStack Query in Phase 1's
 * mock form, and later the real `/ws/markets` push). This component ticks
 * the displayed seconds locally between updates purely for a smooth
 * per-second UI -- it recomputes remaining time from the last known
 * server sample + elapsed wall-clock time, but NEVER treats that
 * interpolation as authoritative: the trading-restriction tier badge is
 * always the literal value the server last sent, not something derived
 * from browser time. See lib/calc/countdown.ts#interpolateSecondsRemaining.
 */
export function Countdown({
  countdown,
  className,
}: {
  countdown: MarketCountdown;
  className?: string;
}) {
  const [displaySeconds, setDisplaySeconds] = useState(countdown.timeRemainingSeconds);

  useEffect(() => {
    // A new authoritative sample arrived -- snap to it, discarding any
    // client-side interpolation drift accumulated since the last one.
    setDisplaySeconds(countdown.timeRemainingSeconds);
  }, [countdown.serverNow, countdown.timeRemainingSeconds]);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplaySeconds(interpolateSecondsRemaining(countdown));
    }, 250);
    return () => clearInterval(id);
  }, [countdown]);

  const tier = TIER_STYLE[countdown.tradingRestriction];
  const Icon = tier.icon;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className="num text-lg font-bold text-ink"
        aria-label={`${Math.ceil(displaySeconds)} seconds remaining`}
      >
        {formatTimeRemaining(displaySeconds)}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
          tier.className,
        )}
      >
        <Icon className="size-3" aria-hidden />
        {RESTRICTION_LABEL[countdown.tradingRestriction]}
      </span>
    </div>
  );
}
