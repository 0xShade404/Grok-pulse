"use client";

import { useState } from "react";
import { Ban, CheckCircle2 } from "lucide-react";
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

/**
 * A destructive-looking admin control that always requires an explicit
 * confirmation step before it fires (CLAUDE.md section 77: admin controls
 * must be clearly consequential, never a bare button). Every instance on
 * /admin is local mock state -- see the "(mock)" caption each caller
 * renders alongside it.
 */
export function AdminToggleControl({
  label,
  enabled,
  onConfirm,
  confirmDisableCopy,
  confirmEnableCopy,
}: {
  label: string;
  enabled: boolean;
  onConfirm: (nextEnabled: boolean) => void;
  confirmDisableCopy: string;
  confirmEnableCopy: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center justify-between gap-3 rounded border border-border bg-panel-2 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-ink">{label}</span>
        <span className={"text-[11px] " + (enabled ? "text-ok" : "text-danger")}>
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant={enabled ? "destructive" : "outline"}>
            {enabled ? (
              <>
                <Ban className="size-3.5" /> Disable
              </>
            ) : (
              <>
                <CheckCircle2 className="size-3.5" /> Enable
              </>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{enabled ? `Disable ${label}?` : `Enable ${label}?`}</DialogTitle>
            <DialogDescription>{enabled ? confirmDisableCopy : confirmEnableCopy}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={enabled ? "destructive" : "default"}
              onClick={() => {
                onConfirm(!enabled);
                setOpen(false);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
