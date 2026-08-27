/**
 * MOCK FIXTURE MODULE -- Phase 1 (CLAUDE.md section 81, 90).
 *
 * This file exists as the single, obviously-named entry point that
 * `lib/api/*` imports from. It re-exports `lib/mock/*` -- the fixtures are
 * split into one file per domain for readability, but this is the seam a
 * reviewer (or a future `DATA_SOURCE=live` implementation) should look at
 * to see everything the Phase 1 UI fabricates instead of fetching.
 *
 * DATA_SOURCE is always "mock" in this phase -- there is no backend to set
 * it to "live" yet. See CLAUDE.md section 90.
 */
export const DATA_SOURCE = "mock" as const;

export * from "./mock/index";
