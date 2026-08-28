import { z } from "zod";

/**
 * Central environment schema. Every service imports `loadConfig()` rather
 * than reading `process.env` directly, so a missing/malformed variable fails
 * fast at boot instead of producing silent misbehavior in a trading path.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(1),

  XAI_API_KEY: z.string().optional().default(""),
  XAI_MODEL: z.string().default("grok-4"),

  POLYMARKET_API_KEY: z.string().optional().default(""),
  POLYMARKET_API_SECRET: z.string().optional().default(""),
  POLYMARKET_API_PASSPHRASE: z.string().optional().default(""),
  POLYMARKET_CLOB_HOST: z.string().url().default("https://clob.polymarket.com"),
  POLYMARKET_CHAIN_ID: z.coerce.number().int().default(137),

  WALLET_PROVIDER: z.string().optional().default(""),
  WALLET_ADDRESS: z.string().optional().default(""),

  // On-chain USDC funding check for non-custodial live orders (CLAUDE.md
  // section 19: "account funded" must be independently verified, not
  // assumed). Both default to "" (disabled) so existing deployments aren't
  // broken by this addition -- apps/api's funding checker treats either
  // being unset as "cannot verify balance" and FAILS CLOSED (treats the
  // account as unfunded) rather than ever defaulting to `true`. The correct
  // current USDC contract address on Polygon PoS (native vs. bridged
  // USDC.e) cannot be verified from this sandbox, so it is intentionally a
  // configurable value rather than a hardcoded one -- an operator must set
  // it explicitly before live trading's funding check can ever pass.
  POLYGON_RPC_URL: z.string().optional().default(""),
  POLYGON_USDC_ADDRESS: z.string().optional().default(""),

  COINBASE_WS_URL: z.string().url().default("wss://advanced-trade-ws.coinbase.com"),
  BINANCE_WS_URL: z.string().url().default("wss://stream.binance.com:9443/ws"),

  SENTRY_DSN: z.string().optional().default(""),
  PROMETHEUS_PORT: z.coerce.number().int().default(9464),

  // Feature flags. ENABLE_LIVE_TRADING and ENABLE_AUTO_EXECUTION default to
  // false and must be explicitly set to "true" by an operator -- see
  // CLAUDE.md sections 22, 61, 62, 83, 96.
  ENABLE_LIVE_TRADING: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  ENABLE_PAPER_TRADING: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  ENABLE_GROK: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  ENABLE_BACKTESTING: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  ENABLE_BTC: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  ENABLE_ETH: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  ENABLE_AUTO_EXECUTION: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  ENABLE_MOBILE_TRADING: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

  DATA_SOURCE: z.enum(["mock", "live"]).default("mock"),
});

export type GrokPulseConfig = z.infer<typeof EnvSchema>;

let cached: GrokPulseConfig | undefined;

/**
 * Parse and validate `process.env`. Throws on startup if required variables
 * are missing or malformed -- fail closed rather than trading on undefined
 * configuration (CLAUDE.md section 56).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GrokPulseConfig {
  if (cached) return cached;
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

/** For tests only: reset the memoized config so a fresh env can be loaded. */
export function __resetConfigCacheForTests(): void {
  cached = undefined;
}
