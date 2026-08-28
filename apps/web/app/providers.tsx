"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { TooltipProvider } from "@/components/ui/tooltip";
import { wagmiConfig } from "@/lib/wagmi/config";

export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser session (CLAUDE.md section 29: TanStack
  // Query owns REST/server-state caching; Zustand owns local/live state).
  //
  // wagmi v2's own hooks (useConnect, useBalance, useSwitchChain, etc.) are
  // themselves built on TanStack Query internally and require a
  // QueryClientProvider ancestor. We deliberately share this single
  // QueryClient with wagmi rather than standing up a second one: the app's
  // REST queries and wagmi's on-chain/wallet queries use disjoint query
  // keys, so there's no cache-collision risk, and one client means one set
  // of defaults (staleTime, retry policy) and one devtools/inspection
  // surface instead of two independent caches to reason about.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
