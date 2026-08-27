import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "./index.js";

function captureStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { chunks, stream };
}

describe("createLogger", () => {
  it("includes service and environment on every log line", () => {
    const { chunks, stream } = captureStream();
    const logger = createLogger({ service: "test-service", environment: "test", destination: stream });
    logger.info("hello");
    expect(chunks.length).toBe(1);
    const parsed = JSON.parse(chunks[0]!);
    expect(parsed.service).toBe("test-service");
    expect(parsed.environment).toBe("test");
    expect(parsed.msg).toBe("hello");
  });

  it("redacts secret-shaped fields per CLAUDE.md section 80", () => {
    const { chunks, stream } = captureStream();
    const logger = createLogger({ service: "test-service", environment: "test", destination: stream });
    logger.info(
      { creds: { apiSecret: "super-secret", authSecret: "another-secret", token: "abc123" } },
      "booted",
    );
    const parsed = JSON.parse(chunks[0]!);
    expect(parsed.creds.apiSecret).toBe("[REDACTED]");
    expect(parsed.creds.authSecret).toBe("[REDACTED]");
    expect(parsed.creds.token).toBe("[REDACTED]");
  });

  it("respects the configured log level", () => {
    const { chunks, stream } = captureStream();
    const logger = createLogger({
      service: "test-service",
      environment: "test",
      level: "error",
      destination: stream,
    });
    logger.info("should be suppressed");
    logger.error("should appear");
    expect(chunks.length).toBe(1);
    expect(JSON.parse(chunks[0]!).msg).toBe("should appear");
  });

  it("does not throw when constructing a logger with only required options", () => {
    expect(() => createLogger({ service: "svc", environment: "test" })).not.toThrow();
  });
});
