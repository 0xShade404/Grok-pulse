import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide w-fit whitespace-nowrap shrink-0 [&_svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-border-strong bg-panel-2 text-ink-dim",
        accent: "border-accent/40 bg-accent-soft text-accent",
        buy: "border-buy/40 bg-buy-soft text-buy",
        sell: "border-sell/40 bg-sell-soft text-sell",
        warn: "border-warn/40 bg-warn-soft text-warn",
        danger: "border-danger/40 bg-danger-soft text-danger",
        ok: "border-ok/40 bg-ok-soft text-ok",
        neutral: "border-border-strong bg-neutral-soft text-neutral",
        outline: "border-border-strong bg-transparent text-ink-dim",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
