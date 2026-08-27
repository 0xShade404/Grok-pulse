import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full rounded-md border border-border-strong bg-panel-2 px-2.5 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus-visible:border-accent focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-40",
        "tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
