import type { SystemHealthSnapshot } from "@grokpulse/types";

/**
 * Result of a halt-required evaluation. `reasons` is a human-readable list
 * suitable for logging, admin dashboards, and audit events (CLAUDE.md
 * section 41). It is intentionally always populated with every applicable
 * reason (not just the first one) -- unlike RiskEngine.evaluate(), which
 * short-circuits on the first rejection, an operator deciding whether to
 * even attempt trading wants the *complete* picture of what's wrong.
 */
export interface HaltStatus {
  halted: boolean;
  reasons: string[];
}

/**
 * Pure aggregation of the system-health kill conditions from CLAUDE.md
 * section 38 ("Kill Conditions") and section 22 ("Live Trading Safety").
 *
 * This function only considers the subset of section 38's conditions that
 * are pure system-health signals, carried on SystemHealthSnapshot:
 *   - risk engine unavailable
 *   - signer unavailable
 *   - database state inconsistent / unhealthy
 *   - redis unhealthy
 *   - system clock unreliable
 *   - kill switch engaged (section 22)
 *   - strategy disabled
 *
 * The remaining section 38 conditions -- market data stale, underlying
 * data stale, exchange/Polymarket connection unhealthy, daily loss limit
 * reached, position reconciliation failure, unexpected order state -- are
 * NOT evaluated here because they require MarketStateSnapshot /
 * PortfolioStateSnapshot / order-lifecycle context that this function does
 * not receive. Those are evaluated directly inside RiskEngine.evaluate(),
 * which is the sole authority for a specific trade attempt. isHaltRequired
 * is a lighter-weight, infrastructure-only pre-flight check callers can use
 * to decide whether it's even worth constructing an evaluate() input (e.g.
 * to short-circuit a polling loop or to drive an admin "system health"
 * indicator), and it is intentionally cheap to call on every tick.
 *
 * Deterministic and side-effect free: same input always produces the same
 * output.
 */
export function isHaltRequired(health: SystemHealthSnapshot): HaltStatus {
  const reasons: string[] = [];

  if (!health.riskEngineAvailable) {
    reasons.push("Risk engine is unavailable.");
  }
  if (!health.signerAvailable) {
    reasons.push("Order signer is unavailable.");
  }
  if (!health.databaseHealthy) {
    reasons.push("Database is unhealthy or unreachable.");
  }
  if (!health.redisHealthy) {
    reasons.push("Redis is unhealthy or unreachable.");
  }
  if (!health.clockReliable) {
    reasons.push("System clock is unreliable (drift detected).");
  }
  if (health.killSwitchEngaged) {
    reasons.push("Emergency kill switch is engaged.");
  }
  if (!health.strategyEnabled) {
    reasons.push("Strategy is administratively disabled.");
  }

  return { halted: reasons.length > 0, reasons };
}
