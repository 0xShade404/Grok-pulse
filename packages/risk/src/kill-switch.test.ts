import { describe, expect, it } from "vitest";
import { isHaltRequired } from "./kill-switch.js";
import { baseHealth } from "./test-fixtures.js";

describe("isHaltRequired", () => {
  it("reports not halted when every system-health flag is healthy", () => {
    const status = isHaltRequired(baseHealth());
    expect(status.halted).toBe(false);
    expect(status.reasons).toEqual([]);
  });

  it("reports halted with one reason for a single unhealthy flag", () => {
    const status = isHaltRequired(baseHealth({ redisHealthy: false }));
    expect(status.halted).toBe(true);
    expect(status.reasons).toHaveLength(1);
    expect(status.reasons[0]!.toLowerCase()).toContain("redis");
  });

  it("aggregates every simultaneous halt reason rather than stopping at the first", () => {
    const status = isHaltRequired(
      baseHealth({
        riskEngineAvailable: false,
        databaseHealthy: false,
        redisHealthy: false,
        clockReliable: false,
        killSwitchEngaged: true,
        strategyEnabled: false,
        signerAvailable: false,
      }),
    );

    expect(status.halted).toBe(true);
    expect(status.reasons).toHaveLength(7);
  });

  it.each([
    ["riskEngineAvailable", { riskEngineAvailable: false }, "risk engine"],
    ["signerAvailable", { signerAvailable: false }, "signer"],
    ["databaseHealthy", { databaseHealthy: false }, "database"],
    ["redisHealthy", { redisHealthy: false }, "redis"],
    ["clockReliable", { clockReliable: false }, "clock"],
    ["killSwitchEngaged", { killSwitchEngaged: true }, "kill switch"],
    ["strategyEnabled", { strategyEnabled: false }, "strategy"],
  ] as const)("flags %s individually with a human-readable reason", (_field, override, expectedSubstring) => {
    const status = isHaltRequired(baseHealth(override));
    expect(status.halted).toBe(true);
    expect(status.reasons.some((r) => r.toLowerCase().includes(expectedSubstring))).toBe(true);
  });

  it("is a pure function: identical input always produces identical output", () => {
    const health = baseHealth({ killSwitchEngaged: true });
    const a = isHaltRequired(health);
    const b = isHaltRequired(health);
    expect(a).toEqual(b);
  });
});
