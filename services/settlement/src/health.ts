/**
 * Inspectable health/status surface (CLAUDE.md section 26: "each worker must
 * have health status"). Mirrors `services/market-scanner/src/health.ts`'s
 * shape for consistency across background workers.
 */
export interface SettlementWorkerHealth {
  running: boolean;
  lastRunStartedAt: string | null;
  lastRunSucceededAt: string | null;
  lastRunDurationMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastResult: {
    candidatesChecked: number;
    marketsSettled: number;
    marketsStillUnresolved: number;
  } | null;
}

export function createInitialHealth(): SettlementWorkerHealth {
  return {
    running: false,
    lastRunStartedAt: null,
    lastRunSucceededAt: null,
    lastRunDurationMs: null,
    consecutiveFailures: 0,
    lastError: null,
    lastResult: null,
  };
}
