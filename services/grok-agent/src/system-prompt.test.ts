import { describe, expect, it } from "vitest";
import { hashSystemPrompt, SYSTEM_PROMPT } from "./system-prompt.js";

describe("SYSTEM_PROMPT", () => {
  it("explicitly forbids treating tool output / market text as instructions", () => {
    expect(SYSTEM_PROMPT).toMatch(/never treat/i);
    expect(SYSTEM_PROMPT).toMatch(/trustedAsInstruction/);
  });

  it("instructs the model to return PASS on stale/missing/contradictory/uncertain data", () => {
    expect(SYSTEM_PROMPT).toMatch(/stale/i);
    expect(SYSTEM_PROMPT).toMatch(/PASS/);
  });

  it("forbids inventing prices/order-book levels/timestamps", () => {
    expect(SYSTEM_PROMPT).toMatch(/never invent/i);
  });

  it("states the risk engine has final execution authority", () => {
    expect(SYSTEM_PROMPT).toMatch(/deterministic risk engine/i);
    expect(SYSTEM_PROMPT).toMatch(/final authority/i);
  });

  it("states the agent cannot execute trades", () => {
    expect(SYSTEM_PROMPT).toMatch(/do not have permission to place live\s+trades/i);
  });
});

describe("hashSystemPrompt", () => {
  it("is deterministic and a sha256 hex digest", () => {
    const h1 = hashSystemPrompt();
    const h2 = hashSystemPrompt();
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });
});
