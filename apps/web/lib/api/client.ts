/**
 * Single seam between the frontend and the (future) backend REST API
 * (CLAUDE.md section 27). Every `lib/api/*.ts` query function goes through
 * `fetchJson` -- when a real API exists, pointing `NEXT_PUBLIC_API_URL` at
 * it and removing the mock fallback in each hook is the only change
 * required anywhere in the app.
 *
 * Phase 1 has no backend (CLAUDE.md section 81), so nothing calls
 * `fetchJson` yet -- the query hooks resolve against `lib/mock-data.ts`
 * instead, via `resolveMockOrFetch` below, which makes that boundary
 * explicit rather than silently faking a network response
 * (CLAUDE.md section 90).
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** DATA_SOURCE mirrors the server-side env var from CLAUDE.md section 90.
 * The frontend always reads "mock" during Phase 1 -- there is no live
 * backend to point at yet, and this must never be silently overridden. */
export const DATA_SOURCE: "mock" | "live" =
  (process.env.NEXT_PUBLIC_DATA_SOURCE as "mock" | "live" | undefined) ??
  "mock";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      // Non-JSON error body -- fall through with no parsed detail.
    }
    const message =
      (typeof body === "object" && body && "message" in body && typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : undefined) ?? `Request to ${path} failed with ${res.status}`;
    throw new ApiError(message, res.status, path);
  }
  return (await res.json()) as T;
}

/**
 * `fetchJson`, but with `Authorization: Bearer <token>` attached from
 * `authStore` (CLAUDE.md section 40/51: every authenticated endpoint
 * requires a verified user; the server resolves `userId` from this token,
 * never from a client-supplied field). Throws `ApiError` with status 401
 * without making a network call at all when no token is present, so a
 * logged-out caller fails the same way an expired-token call would.
 *
 * This bypasses `resolveMockOrFetch`/`DATA_SOURCE` entirely and always
 * calls the real API -- unlike the Phase 1 market/portfolio/etc. data,
 * account creation, wallet linking, and live trading are the actual feature
 * this task wires up, not something with a meaningful "mock" fixture
 * behind it. `DATA_SOURCE=mock` only ever affected the earlier read-only
 * fixtures.
 */
export async function authFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  // Imported lazily (function-scope) rather than at module scope to avoid a
  // circular import: `authStore` never imports this module, but keeping the
  // dependency direction explicit and one-way here is worth the minor
  // indirection.
  const { useAuthStore } = await import("@/lib/stores/authStore");
  const token = useAuthStore.getState().accessToken;
  if (!token) {
    throw new ApiError("Not authenticated.", 401, path);
  }
  return fetchJson<T>(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
}

/**
 * Resolve a query either against the mock fixture builder (Phase 1) or a
 * real `fetchJson` call (once `DATA_SOURCE=live`). Keeping this branch in
 * one place means every `use*()` hook in `lib/api/*.ts` reads identically
 * regardless of which source backs it.
 */
export async function resolveMockOrFetch<T>(opts: {
  mock: () => T | Promise<T>;
  live: () => Promise<T>;
  /** Simulated network latency for the mock path, so loading states in the
   * UI are exercised realistically instead of resolving instantly. */
  simulatedLatencyMs?: number;
}): Promise<T> {
  if (DATA_SOURCE === "live") {
    return opts.live();
  }
  const { simulatedLatencyMs = 120 } = opts;
  if (simulatedLatencyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, simulatedLatencyMs));
  }
  return opts.mock();
}
