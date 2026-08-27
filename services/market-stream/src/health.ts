import type { UnderlyingSourceHealth } from "./underlying/types.js";

/**
 * Inspectable health/status surface (CLAUDE.md section 26). No HTTP server
 * here -- that's `apps/api`'s job (section 78); `MarketStreamService.getHealth()`
 * returns a plain object other code (or a future health endpoint) can read.
 */
export interface MarketStreamHealth {
  running: boolean;
  polymarketWsConnected: boolean;
  activeMarketsCount: number;
  lastPolymarketMessageAt: string | null;
  lastPolymarketMessageAgeMs: number | null;
  lastScannerEventConsumedAt: string | null;
  lastError: string | null;
  underlying: {
    coinbase: UnderlyingSourceHealth;
  };
}
