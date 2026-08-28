"use client";

import { useState } from "react";
import { ShieldAlert, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusIndicator } from "@/components/StatusIndicator";
import { setLiveTradingOptIn } from "@/lib/api/auth";
import { useAuthStore } from "@/lib/stores/authStore";

/**
 * Live-trading opt-in (CLAUDE.md section 22): "explicit confirmation" is a
 * named, separate step -- not implied by a settings toggle. Enabling
 * requires this dialog, an explicit "I understand the risks" checkbox, and
 * only then does the confirm button call the real
 * `POST /api/account/live-trading`. Disabling is deliberately low-friction
 * (no dialog) -- CLAUDE.md's "capital preservation > trading frequency"
 * ordering (section 94) means turning trading OFF should never be harder
 * than turning it on.
 */
export function LiveTradingControls() {
  const liveTradingEnabled = useAuthStore((s) => s.liveTradingEnabled);
  const setLiveTradingEnabled = useAuthStore((s) => s.setLiveTradingEnabled);
  const walletVerified = useAuthStore((s) => s.wallet?.verified ?? false);

  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnable() {
    setSubmitting(true);
    setError(null);
    try {
      await setLiveTradingOptIn({ enabled: true, confirmation: "I_UNDERSTAND_THE_RISKS" });
      setLiveTradingEnabled(true);
      setOpen(false);
      setUnderstood(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not enable live trading.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDisable() {
    setSubmitting(true);
    setError(null);
    try {
      await setLiveTradingOptIn({ enabled: false });
      setLiveTradingEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disable live trading.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-dim">Live trading</span>
        <StatusIndicator state={liveTradingEnabled ? "LIVE" : "PAPER"} />
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-danger">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {liveTradingEnabled ? (
        <Button type="button" variant="outline" disabled={submitting} onClick={handleDisable}>
          Disable live trading
        </Button>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button type="button" variant="destructive" disabled={!walletVerified}>
              <ShieldAlert className="size-4" aria-hidden />
              Enable live trading
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Enable live trading with real funds?</DialogTitle>
              <DialogDescription>
                Once enabled, orders placed from the terminal are submitted to Polymarket
                and settled from your connected wallet&rsquo;s own funds -- GrokPulse never
                holds your funds and cannot reverse a submitted order.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded border border-border bg-panel-2 p-2.5 text-[11px] leading-relaxed text-ink-dim">
              Trading prediction markets involves financial risk. AI-generated signals
              are estimates, not guarantees. Past performance does not guarantee future
              results. The deterministic risk engine can reject an order for any reason
              at the time you submit it.
            </div>

            <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
              I understand the risks and want to enable live trading.
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={!understood || submitting} onClick={handleEnable}>
                {submitting ? "Enabling..." : "Confirm: enable live trading"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {!liveTradingEnabled && !walletVerified && (
        <p className="text-[11px] text-ink-faint">Link and verify a wallet before enabling live trading.</p>
      )}
    </div>
  );
}
