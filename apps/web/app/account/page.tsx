"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WalletLinkPanel } from "@/components/WalletLinkPanel";
import { LiveTradingControls } from "@/components/LiveTradingControls";
import { useAuthStore } from "@/lib/stores/authStore";

export default function AccountPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const logout = useAuthStore((s) => s.logout);

  if (!user || !isAuthenticated) {
    return (
      <div className="flex flex-1 flex-col items-center gap-3 p-8">
        <p className="text-sm text-ink-dim">You need to log in to view your account.</p>
        <Button onClick={() => router.push("/login")}>Log in</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-ink">{user.username}</p>
            <p className="text-[11px] text-ink-faint">User ID: {user.userId}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              logout();
              router.push("/");
            }}
          >
            <LogOut className="size-3.5" aria-hidden />
            Log out
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
        </CardHeader>
        <CardContent>
          <CardDescription className="mb-3">
            Non-custodial: connecting a wallet lets you sign orders yourself. GrokPulse
            never holds your funds, so there is no deposit or withdrawal step here.
          </CardDescription>
          <WalletLinkPanel />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live Trading</CardTitle>
        </CardHeader>
        <CardContent>
          <LiveTradingControls />
        </CardContent>
      </Card>
    </div>
  );
}
