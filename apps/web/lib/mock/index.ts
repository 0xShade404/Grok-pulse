/**
 * MOCK FIXTURE MODULE -- Phase 1 (CLAUDE.md section 81, 90).
 *
 * Barrel export for every mock/placeholder data builder used by the UI
 * while no backend exists. Nothing under lib/mock/ talks to a real service;
 * every function here is pure and deterministic-ish (seeded by `now`), so
 * swapping a real `DATA_SOURCE=live` fetch in later touches only
 * lib/api/*.ts, never these fixtures or the components that render them.
 */
export * from "./markets";
export * from "./orderbook";
export * from "./signals";
export * from "./portfolio";
export * from "./performance";
export * from "./admin";
export * from "./agentStats";
