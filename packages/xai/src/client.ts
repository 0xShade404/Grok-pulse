/**
 * `XaiClient` -- low-level wrapper around xAI's OpenAI-compatible chat
 * completions endpoint. See `types.ts` for why this is built on plain
 * `fetch` against the documented REST shape rather than a higher-level SDK.
 *
 * This client knows nothing about GrokPulse's domain (markets, signals,
 * risk). It is a narrow, typed, retrying HTTP client for one endpoint.
 * `services/grok-agent` is the layer that knows about `AgentSignal`,
 * `wrapToolResult`, and the GrokPulse tool-calling loop.
 */
import { z } from "zod";
import { DEFAULT_BACKOFF_OPTIONS, computeBackoffDelayMs, type BackoffOptions } from "./backoff.js";
import {
  XaiAuthError,
  XaiClientError,
  XaiMalformedResponseError,
  XaiNetworkError,
  XaiRateLimitError,
  XaiRequestError,
  XaiServerError,
  XaiTimeoutError,
} from "./errors.js";
import type {
  XaiChatParams,
  XaiChatResult,
  XaiClientConfig,
  XaiMessage,
  XaiToolCall,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.x.ai/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Loose schema for the OpenAI-compatible chat completions response body.
 * Deliberately permissive (`.passthrough()` isn't needed since we only read
 * named fields) -- we validate just enough structure to safely extract the
 * fields `XaiChatResult` needs; anything else is preserved verbatim in
 * `raw` for the audit trail.
 */
const RawToolCallSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const RawChoiceSchema = z.object({
  message: z.object({
    role: z.string().optional(),
    content: z.string().nullable().optional(),
    tool_calls: z.array(RawToolCallSchema).optional(),
  }),
  finish_reason: z.string().nullable().optional(),
});

const RawUsageSchema = z
  .object({
    prompt_tokens: z.number().optional(),
    completion_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  })
  .optional();

const RawChatResponseSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(RawChoiceSchema).min(1),
  usage: RawUsageSchema,
});

const RawErrorBodySchema = z.object({
  error: z
    .union([
      z.string(),
      z.object({
        message: z.string().optional(),
        type: z.string().optional(),
        code: z.union([z.string(), z.number()]).optional(),
      }),
    ])
    .optional(),
});

export class XaiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoff: Partial<BackoffOptions>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: XaiClientConfig) {
    if (!config.apiKey) {
      throw new Error("XaiClient requires a non-empty apiKey");
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoff = { ...DEFAULT_BACKOFF_OPTIONS, ...config.backoff };
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /**
   * Run one chat-completions request. Retries transient failures
   * (timeout/network/5xx/429) with backoff; auth and malformed-request
   * failures are not retried. Never throws for a well-formed but
   * model-produced-bad-content response -- that distinction (schema
   * validation of the model's structured output) is the caller's job.
   */
  async chat(params: XaiChatParams): Promise<XaiChatResult> {
    return this.withRetry("chat", () => this.doChat(params));
  }

  private async doChat(params: XaiChatParams): Promise<XaiChatResult> {
    const body = this.buildRequestBody(params);
    const response = await this.withTimeout("chat", (signal) =>
      this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }),
    );

    if (!response.ok) {
      throw await this.classifyErrorResponse("chat", response);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      throw new XaiMalformedResponseError("chat", err);
    }

    const parsed = RawChatResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new XaiMalformedResponseError("chat", parsed.error);
    }

    const choice = parsed.data.choices[0];
    if (!choice) {
      throw new XaiMalformedResponseError("chat", new Error("no choices in response"));
    }

    const toolCalls: XaiToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      argumentsJson: tc.function.arguments,
    }));

    const usage = parsed.data.usage
      ? {
          promptTokens: parsed.data.usage.prompt_tokens ?? 0,
          completionTokens: parsed.data.usage.completion_tokens ?? 0,
          totalTokens: parsed.data.usage.total_tokens ?? 0,
        }
      : undefined;

    return {
      id: parsed.data.id ?? "",
      model: parsed.data.model ?? params.model,
      message: {
        role: "assistant",
        content: choice.message.content ?? null,
        toolCalls,
      },
      finishReason: choice.finish_reason ?? "unknown",
      usage,
      raw: json,
    };
  }

  private buildRequestBody(params: XaiChatParams): Record<string, unknown> {
    const messages = params.messages.map((m) => this.toWireMessage(m));
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
    };
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (params.toolChoice) {
      body.tool_choice = params.toolChoice;
    }
    if (params.responseFormat) {
      // TODO: verify against https://docs.x.ai -- this mirrors OpenAI's
      // `response_format: { type: "json_schema", json_schema: {...} }`
      // structured-output wrapper.
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: params.responseFormat.jsonSchema.name,
          schema: params.responseFormat.jsonSchema.schema,
          strict: params.responseFormat.jsonSchema.strict ?? true,
        },
      };
    }
    if (typeof params.temperature === "number") {
      body.temperature = params.temperature;
    }
    if (typeof params.maxOutputTokens === "number") {
      // TODO: verify against https://docs.x.ai -- field name may be
      // `max_completion_tokens` on newer API versions.
      body.max_tokens = params.maxOutputTokens;
    }
    return body;
  }

  private toWireMessage(m: XaiMessage): Record<string, unknown> {
    const wire: Record<string, unknown> = {
      role: m.role,
      content: m.content ?? null,
    };
    if (m.toolCalls && m.toolCalls.length > 0) {
      wire.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.argumentsJson },
      }));
    }
    if (m.toolCallId) {
      wire.tool_call_id = m.toolCallId;
    }
    if (m.name) {
      wire.name = m.name;
    }
    return wire;
  }

  private async classifyErrorResponse(
    operation: string,
    response: Response,
  ): Promise<XaiClientError> {
    const status = response.status;
    let message: string | undefined;
    try {
      const json: unknown = await response.json();
      const parsed = RawErrorBodySchema.safeParse(json);
      if (parsed.success) {
        message =
          typeof parsed.data.error === "string" ? parsed.data.error : parsed.data.error?.message;
      }
    } catch {
      // Body wasn't JSON (or was empty) -- fall through with no message.
    }
    const cause = message ? new Error(message) : undefined;

    if (status === 401 || status === 403) {
      return new XaiAuthError(operation, status, cause);
    }
    if (status === 429) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
      return new XaiRateLimitError(
        operation,
        Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      );
    }
    if (status >= 500) {
      return new XaiServerError(operation, status, cause);
    }
    return new XaiRequestError(operation, status, cause);
  }

  private async withTimeout<T>(
    operation: string,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fn(controller.signal);
    } catch (err) {
      if (isAbortError(err)) {
        throw new XaiTimeoutError(operation, this.timeoutMs);
      }
      if (err instanceof XaiClientError) {
        throw err;
      }
      throw new XaiNetworkError(operation, err);
    } finally {
      clearTimeout(timer);
    }
  }

  private async withRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        const retryable = err instanceof XaiClientError ? err.retryable : true;
        if (!retryable || attempt === this.maxAttempts) {
          throw err;
        }
        const delayMs = computeBackoffDelayMs(attempt, this.backoff);
        await sleep(delayMs);
      }
    }
    // Unreachable, but keeps TypeScript happy about the return type.
    throw lastError;
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
