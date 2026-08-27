/**
 * Types for the xAI Grok API client.
 *
 * Approach taken (see the package README section in this file's header
 * comment, and the top-level report from `services/grok-agent`): no
 * official `@ai-sdk/xai` (or similar) integration is used here. That
 * package's public surface is the Vercel AI SDK's generic provider
 * abstraction (`generateText`/`streamText`/`generateObject` against a
 * `LanguageModel`), which is shaped very differently from the narrow
 * "chat completions with tool-calling and a JSON-schema response format"
 * client this codebase's contract calls for, and pinning + verifying its
 * exact tool-calling/structured-output wire behavior across SDK major
 * versions from inside this sandbox (no live network access to xAI, so no
 * way to exercise it end-to-end) would mean trusting unverified memory of
 * its API anyway -- exactly what CLAUDE.md section 84.3 ("do not invent
 * APIs") warns against.
 *
 * Instead this client is built directly against xAI's publicly-documented,
 * OpenAI-compatible REST shape (`POST /v1/chat/completions` with
 * `messages`, `tools`, `tool_choice`, `response_format`), using plain
 * `fetch`. That shape is stable, well-established, and small enough to
 * implement and test precisely. Fields marked below with a `TODO: verify
 * against https://docs.x.ai` comment are the ones this implementation is
 * least certain about (exact `response_format` JSON-schema wrapper shape,
 * the `max_tokens` vs `max_completion_tokens` field name) and should be
 * confirmed against current xAI docs before production use.
 */

export type XaiRole = "system" | "user" | "assistant" | "tool";

export interface XaiToolCall {
  /** Provider-assigned id for this tool call; echoed back on the
   * corresponding `role: "tool"` response message. */
  id: string;
  /** The tool/function name the model wants to invoke. */
  name: string;
  /** Raw JSON string of arguments, exactly as returned by the model.
   * Never trusted as-is -- callers must `JSON.parse` and schema-validate
   * this before using it (CLAUDE.md section 18/53). */
  argumentsJson: string;
}

export interface XaiMessage {
  role: XaiRole;
  /** Text content. Required for system/user messages; may be `null` on an
   * assistant message that is only requesting tool calls. */
  content?: string | null;
  /** Only present on an assistant message that is requesting tool calls. */
  toolCalls?: XaiToolCall[];
  /** Required on `role: "tool"` messages: which tool call this responds to. */
  toolCallId?: string;
  /** Required on `role: "tool"` messages: the name of the tool that was
   * called (OpenAI-compatible chat completions expects this on tool
   * messages alongside `tool_call_id`). */
  name?: string;
}

export interface XaiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's arguments. Kept as a plain
   * object (not zod) here since it crosses the wire as JSON Schema. */
  parameters: Record<string, unknown>;
}

export interface XaiJsonSchemaResponseFormat {
  type: "json_schema";
  jsonSchema: {
    name: string;
    schema: Record<string, unknown>;
    /** Request strict schema adherence where the provider supports it. */
    strict?: boolean;
  };
}

export interface XaiChatParams {
  model: string;
  messages: XaiMessage[];
  tools?: XaiToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  responseFormat?: XaiJsonSchemaResponseFormat;
  temperature?: number;
  /** TODO: verify against https://docs.x.ai whether the wire field is
   * `max_tokens` or `max_completion_tokens` on the current API version.
   * This client sends `max_tokens` (the longstanding OpenAI-compatible
   * field name) via this parameter. */
  maxOutputTokens?: number;
}

export interface XaiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface XaiChatResult {
  id: string;
  model: string;
  message: {
    role: "assistant";
    content: string | null;
    toolCalls: XaiToolCall[];
  };
  finishReason: string;
  usage?: XaiUsage;
  /** Full raw parsed JSON response body -- retained for the agent-run audit
   * trail (CLAUDE.md section 64) and debugging. Never re-parsed to decide
   * trading action; `message`/`finishReason`/`usage` above are the only
   * structured surface callers should reason about. */
  raw: unknown;
}

export interface XaiClientConfig {
  apiKey: string;
  /** Defaults to xAI's production API base. */
  baseUrl?: string;
  /** Per-attempt timeout, in ms. Default 30s (CLAUDE.md section 72 targets
   * sub-2s typical AI analysis latency, but a generous outer timeout still
   * bounds worst-case tail latency without starving a slow-but-healthy call). */
  timeoutMs?: number;
  /** Max attempts (including the first) for retryable failures. */
  maxAttempts?: number;
  backoff?: Partial<import("./backoff.js").BackoffOptions>;
  /** Inject a fake fetch for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}
