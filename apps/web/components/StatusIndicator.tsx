import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  FlaskConical,
  Radio,
  ShieldAlert,
  WifiOff,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Every trading-relevant state in the terminal renders through this
 * component. CLAUDE.md section 49 is explicit: "Do not use color as the
 * only indicator" -- so each state below pairs a color with a distinct
 * icon AND a text label, never color alone.
 */
export type TerminalState =
  | "LIVE"
  | "PAPER"
  | "HALTED"
  | "STALE_DATA"
  | "HIGH_RISK"
  | "MEDIUM_RISK"
  | "LOW_RISK"
  | "ORDER_PENDING"
  | "FILLED"
  | "REJECTED"
  | "CANCELLED"
  | "CONNECTED"
  | "DEGRADED"
  | "DISCONNECTED"
  | "HEALTHY"
  | "DOWN";

interface StateConfig {
  label: string;
  icon: LucideIcon;
  className: string;
}

const STATE_CONFIG: Record<TerminalState, StateConfig> = {
  LIVE: { label: "LIVE", icon: Radio, className: "border-danger/50 bg-danger-soft text-danger" },
  PAPER: { label: "PAPER", icon: FlaskConical, className: "border-info/40 bg-info-soft text-info" },
  HALTED: { label: "HALTED", icon: Ban, className: "border-danger/50 bg-danger-soft text-danger" },
  STALE_DATA: {
    label: "STALE DATA",
    icon: WifiOff,
    className: "border-warn/50 bg-warn-soft text-warn",
  },
  HIGH_RISK: {
    label: "HIGH RISK",
    icon: ShieldAlert,
    className: "border-danger/50 bg-danger-soft text-danger",
  },
  MEDIUM_RISK: {
    label: "MEDIUM RISK",
    icon: AlertTriangle,
    className: "border-warn/50 bg-warn-soft text-warn",
  },
  LOW_RISK: {
    label: "LOW RISK",
    icon: CheckCircle2,
    className: "border-ok/40 bg-ok-soft text-ok",
  },
  ORDER_PENDING: {
    label: "PENDING",
    icon: Clock,
    className: "border-warn/50 bg-warn-soft text-warn animate-pulse-slow",
  },
  FILLED: { label: "FILLED", icon: CheckCircle2, className: "border-ok/40 bg-ok-soft text-ok" },
  REJECTED: { label: "REJECTED", icon: XCircle, className: "border-danger/50 bg-danger-soft text-danger" },
  CANCELLED: {
    label: "CANCELLED",
    icon: CircleDashed,
    className: "border-border-strong bg-neutral-soft text-neutral",
  },
  CONNECTED: { label: "CONNECTED", icon: CheckCircle2, className: "border-ok/40 bg-ok-soft text-ok" },
  DEGRADED: { label: "DEGRADED", icon: AlertTriangle, className: "border-warn/50 bg-warn-soft text-warn" },
  DISCONNECTED: {
    label: "DISCONNECTED",
    icon: WifiOff,
    className: "border-danger/50 bg-danger-soft text-danger",
  },
  HEALTHY: { label: "HEALTHY", icon: CheckCircle2, className: "border-ok/40 bg-ok-soft text-ok" },
  DOWN: { label: "DOWN", icon: XCircle, className: "border-danger/50 bg-danger-soft text-danger" },
};

export function StatusIndicator({
  state,
  className,
  label,
}: {
  state: TerminalState;
  className?: string;
  /** Override the default label (e.g. append detail) while keeping the icon/color mapping. */
  label?: string;
}) {
  const config = STATE_CONFIG[state];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        config.className,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label ?? config.label}
    </span>
  );
}
