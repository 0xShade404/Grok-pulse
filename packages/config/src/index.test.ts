import { describe, expect, it } from "vitest";
import { __resetConfigCacheForTests, loadConfig } from "./index.js";

const REQUIRED_ENV = {
  DATABASE_URL: "postgres://localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "test-secret",
};

describe("loadConfig", () => {
  it("throws when required variables are missing", () => {
    __resetConfigCacheForTests();
    expect(() => loadConfig({})).toThrow(/Invalid environment configuration/);
  });

  it("parses required variables and applies defaults", () => {
    __resetConfigCacheForTests();
    const config = loadConfig({ ...REQUIRED_ENV });
    expect(config.DATABASE_URL).toBe(REQUIRED_ENV.DATABASE_URL);
    expect(config.NODE_ENV).toBe("development");
    expect(config.DATA_SOURCE).toBe("mock");
  });

  it("defaults live trading and auto-execution to false regardless of other input", () => {
    __resetConfigCacheForTests();
    const config = loadConfig({ ...REQUIRED_ENV });
    expect(config.ENABLE_LIVE_TRADING).toBe(false);
    expect(config.ENABLE_AUTO_EXECUTION).toBe(false);
  });

  it("only enables live trading when explicitly set to the string 'true'", () => {
    __resetConfigCacheForTests();
    const config = loadConfig({ ...REQUIRED_ENV, ENABLE_LIVE_TRADING: "true" });
    expect(config.ENABLE_LIVE_TRADING).toBe(true);
  });

  it("treats any non-'true' value as false (fail closed)", () => {
    __resetConfigCacheForTests();
    const config = loadConfig({ ...REQUIRED_ENV, ENABLE_LIVE_TRADING: "yes" });
    expect(config.ENABLE_LIVE_TRADING).toBe(false);
  });

  it("memoizes the parsed config across calls until reset", () => {
    __resetConfigCacheForTests();
    const first = loadConfig({ ...REQUIRED_ENV });
    const second = loadConfig({ ...REQUIRED_ENV, DATABASE_URL: "postgres://ignored" });
    expect(second).toBe(first);
    expect(second.DATABASE_URL).toBe(REQUIRED_ENV.DATABASE_URL);
  });
});
