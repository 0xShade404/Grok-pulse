import { describe, expect, it, vi } from "vitest";
import { XaiClient } from "./client.js";
import {
  XaiAuthError,
  XaiMalformedResponseError,
  XaiServerError,
  XaiTimeoutError,
} from "./errors.js";
import type { XaiChatParams } from "./types.js";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const BASE_PARAMS: XaiChatParams = {
  model: "grok-4",
  messages: [{ role: "user", content: "hello" }],
};

describe("XaiClient.chat", () => {
  it("throws when constructed without an apiKey", () => {
    expect(() => new XaiClient({ apiKey: "" })).toThrow(/apiKey/);
  });

  it("parses a successful plain-content response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "resp_1",
        model: "grok-4",
        choices: [{ message: { role: "assistant", content: "hi there" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const client = new XaiClient({ apiKey: "test-key", fetchImpl });
    const result = await client.chat(BASE_PARAMS);

    expect(result.message.content).toBe("hi there");
    expect(result.message.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Sends the Authorization header and JSON body; never leaks the key
    // into anything but the header itself.
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.x.ai/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.model).toBe("grok-4");
    expect(sentBody.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("parses a response with tool calls", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        id: "resp_2",
        model: "grok-4",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "get_market", arguments: '{"marketId":"m1"}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      }),
    );
    const client = new XaiClient({ apiKey: "test-key", fetchImpl });
    const result = await client.chat(BASE_PARAMS);

    expect(result.message.content).toBeNull();
    expect(result.message.toolCalls).toEqual([
      { id: "call_1", name: "get_market", argumentsJson: '{"marketId":"m1"}' },
    ]);
    expect(result.finishReason).toBe("tool_calls");
  });

  it("serializes tools, tool_choice, and response_format onto the request body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      }),
    );
    const client = new XaiClient({ apiKey: "test-key", fetchImpl });
    await client.chat({
      ...BASE_PARAMS,
      tools: [
        {
          name: "get_market",
          description: "Return market state.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      ],
      toolChoice: "auto",
      responseFormat: {
        type: "json_schema",
        jsonSchema: { name: "AgentSignal", schema: { type: "object" }, strict: true },
      },
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_market",
          description: "Return market state.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
    ]);
    expect(body.tool_choice).toBe("auto");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "AgentSignal", schema: { type: "object" }, strict: true },
    });
  });

  it("maps 401 to XaiAuthError and does not retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: "invalid api key" }));
    const client = new XaiClient({ apiKey: "bad-key", fetchImpl, maxAttempts: 3 });
    await expect(client.chat(BASE_PARAMS)).rejects.toBeInstanceOf(XaiAuthError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to XaiRateLimitError and retries with backoff, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: "rate limited" }, { "retry-after": "0" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
      );
    const client = new XaiClient({
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 3,
      backoff: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
    });
    const result = await client.chat(BASE_PARAMS);
    expect(result.message.content).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps 5xx to XaiServerError and retries until maxAttempts is exhausted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: "boom" }));
    const client = new XaiClient({
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 3,
      backoff: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
    });
    await expect(client.chat(BASE_PARAMS)).rejects.toBeInstanceOf(XaiServerError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("maps a malformed (schema-invalid) response body to XaiMalformedResponseError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: "shape" }));
    const client = new XaiClient({ apiKey: "test-key", fetchImpl });
    await expect(client.chat(BASE_PARAMS)).rejects.toBeInstanceOf(XaiMalformedResponseError);
  });

  it("maps non-JSON response bodies to XaiMalformedResponseError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
      );
    const client = new XaiClient({ apiKey: "test-key", fetchImpl });
    await expect(client.chat(BASE_PARAMS)).rejects.toBeInstanceOf(XaiMalformedResponseError);
  });

  it("times out and raises XaiTimeoutError when the transport never resolves in time", async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init.signal as AbortSignal;
          signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const client = new XaiClient({ apiKey: "test-key", fetchImpl, timeoutMs: 10, maxAttempts: 1 });
    await expect(client.chat(BASE_PARAMS)).rejects.toBeInstanceOf(XaiTimeoutError);
  });

  it("wraps an unrecognized network failure as retryable and eventually throws it", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network down"));
    const client = new XaiClient({
      apiKey: "test-key",
      fetchImpl,
      maxAttempts: 2,
      backoff: { baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
    });
    await expect(client.chat(BASE_PARAMS)).rejects.toThrow(/network layer/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
