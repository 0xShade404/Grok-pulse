"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { useAuthStore } from "@/lib/stores/authStore";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/terminal", label: "Terminal" },
  { href: "/performance", label: "Performance" },
  { href: "/agent", label: "Agent" },
  { href: "/admin", label: "Admin" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-bg-elevated px-3">
      <div className="flex items-center gap-5">
        <Link href="/" className="flex items-center gap-1.5 text-sm font-bold tracking-tight text-ink">
          <Activity className="size-4 text-accent" aria-hidden />
          GROKPULSE
        </Link>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "bg-panel-2 text-ink"
                    : "text-ink-faint hover:bg-panel-2 hover:text-ink-dim",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-2">
        <ConnectionStatus />
        <ConnectWalletButton />
        {isAuthenticated && user ? (
          <Link
            href="/account"
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-ink-dim hover:bg-panel-2 hover:text-ink"
          >
            <User className="size-3.5" aria-hidden />
            {user.username}
          </Link>
        ) : (
          <div className="flex items-center gap-1">
            <Link
              href="/login"
              className="rounded px-2 py-1 text-xs font-medium text-ink-faint hover:bg-panel-2 hover:text-ink-dim"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded bg-panel-2 px-2 py-1 text-xs font-medium text-ink hover:bg-border"
            >
              Sign up
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
