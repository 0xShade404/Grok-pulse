/**
 * Pure formatting helpers. No trading/risk logic lives here -- just
 * presentation math, kept out of components per CLAUDE.md section 84 point
 * 10 ("Do not place trading logic in React components").
 */

/** Format a 0..1 probability/price as a percentage string, e.g. 0.634 -> "63%". */
export function formatPct(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** Format a 0..1 probability/price as a signed percentage, e.g. 0.07 -> "+7%". */
export function formatSignedPct(value: number, digits = 0): string {
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}

/** Format a Polymarket-style 0..1 share price as a two-decimal string, e.g. 0.6 -> "0.60". */
export function formatPrice(value: number): string {
  return value.toFixed(2);
}

/** Format a USD amount with thousands separators, e.g. 1234.5 -> "$1,234.50". */
export function formatUsd(value: number, digits = 2): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Format a signed USD amount, e.g. -12.3 -> "-$12.30", 5 -> "+$5.00". */
export function formatSignedUsd(value: number, digits = 2): string {
  if (value === 0) return formatUsd(0, digits);
  return value > 0 ? `+${formatUsd(value, digits)}` : formatUsd(value, digits);
}

/** Format a raw asset price, e.g. 118310.42 -> "$118,310.42". */
export function formatAssetPrice(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Format whole seconds remaining as MM:SS (or H:MM:SS beyond an hour).
 * Clamps negative input to 0 -- a market never displays negative time.
 */
export function formatTimeRemaining(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format a millisecond duration compactly, e.g. 940 -> "940ms", 1620 -> "1.62s". */
export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Relative "Xs ago" / "Xm ago" label for a past timestamp. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const deltaMs = now - new Date(iso).getTime();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
