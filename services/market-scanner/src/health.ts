/**
 * Inspectable health/status surface (CLAUDE.md section 26: "each worker must
 * have health status"). No HTTP server here -- that's `apps/api`'s job
 * (section 78); this is a plain object other code (or a future health
 * endpoint wired up by `apps/api`) can read via `MarketScanner.getHealth()`.
 */
export interface MarketScannerHealth {
  running: boolean;
  /** ISO timestamp of the last time `scanOnce()` started, or `null` if it
   * has never run. */
  lastScanStartedAt: string | null;
  /** ISO timestamp of the last successfully COMPLETED scan, or `null`. */
  lastScanSucceededAt: string | null;
  lastScanDurationMs: number | null;
  /** Consecutive failed scans. Reset to 0 on the next success. */
  consecutiveFailures: number;
  lastError: string | null;
  /** Result summary of the most recent scan, for observability. */
  lastResult: {
    scannedCount: number;
    discoveredCount: number;
    lifecycleChangedCount: number;
    skippedCount: number;
  } | null;
}

export function createInitialHealth(): MarketScannerHealth {
  return {
    running: false,
    lastScanStartedAt: null,
    lastScanSucceededAt: null,
    lastScanDurationMs: null,
    consecutiveFailures: 0,
    lastError: null,
    lastResult: null,
  };
}
