import pino from "pino";

/** Fields every structured log line should carry when available (CLAUDE.md section 80). */
export interface LogContext {
  requestId?: string;
  userId?: string;
  marketId?: string;
  strategyVersion?: string;
  signalId?: string;
  orderId?: string;
  [key: string]: unknown;
}

const REDACT_PATHS = [
  "*.privateKey",
  "*.apiSecret",
  "*.apiPassphrase",
  "*.authSecret",
  "*.token",
  "*.password",
  "req.headers.authorization",
  "req.headers.cookie",
];

export interface CreateLoggerOptions {
  service: string;
  environment: string;
  level?: string;
}

/**
 * Structured JSON logger. Never pass secrets (private keys, API secrets,
 * auth tokens) into log fields -- redaction is a backstop, not a substitute
 * for not logging them in the first place (CLAUDE.md section 80).
 */
export function createLogger(options: CreateLoggerOptions) {
  return pino({
    level: options.level ?? "info",
    base: {
      service: options.service,
      environment: options.environment,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
