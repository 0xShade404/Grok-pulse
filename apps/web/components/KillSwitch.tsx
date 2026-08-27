"use client";

import { useState } from "react";
import { Ban, ShieldAlert } from "lucide-react";
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
import { useSettingsStore } from "@/lib/stores/settingsStore";

/**
 * Emergency kill switch (CLAUDE.md section 22, 77). Phase 1 has no
 * backend/order manager for this to actually halt -- flipping it only
 * updates local mock state (`settingsStore`), and that boundary is stated
 * plainly in the UI rather than implying a real system was halted
 * (CLAUDE.md section 90).
 */
export function KillSwitch() {
  const engaged = useSettingsStore((s) => s.killSwitchEngaged);
  const setEngaged = useSettingsStore((s) => s.setKillSwitchEngaged);
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">Kill switch</span>
        <StatusIndicator state={engaged ? "HALTED" : "LOW_RISK"} label={engaged ? "HALTED" : "ARMED"} />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant={engaged ? "outline" : "destructive"}
            className="w-full"
          >
            {engaged ? (
              <>
                <ShieldAlert className="size-4" /> RE-ARM STRATEGY
              </>
            ) : (
              <>
                <Ban className="size-4" /> ENGAGE KILL SWITCH
              </>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{engaged ? "Re-arm the strategy?" : "Engage the emergency kill switch?"}</DialogTitle>
            <DialogDescription>
              {engaged
                ? "This resumes new signal generation and order eligibility."
                : "This disables new orders, marks the strategy halted, and (once connected) would cancel resting orders. This is a mock control -- not yet connected to backend (Phase 1 has no order manager to halt)."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={engaged ? "default" : "destructive"}
              onClick={() => {
                setEngaged(!engaged);
                setOpen(false);
              }}
            >
              {engaged ? "Confirm re-arm" : "Confirm halt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="text-[10px] text-ink-faint">(mock -- not yet connected to backend)</p>
    </div>
  );
}
