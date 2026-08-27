import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthVerifier } from "./verifier.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Server-resolved user id, set only by `requireAuth` after verifying the
     * bearer token. CLAUDE.md section 40: every trading/portfolio route
     * reads `request.userId`, never a client-supplied `userId` field from
     * the body/query/params.
     */
    userId?: string;
  }
}

const BEARER_PREFIX = "Bearer ";

/**
 * Extract the bearer token from an `Authorization` header, or `null` if the
 * header is missing/malformed.
 */
export function extractBearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Fastify `preHandler` factory (CLAUDE.md section 40/51): reads the
 * `Authorization: Bearer <token>` header, calls the injected
 * `AuthVerifier`, and attaches the resolved `userId` to the request.
 * Responds 401 on any missing/invalid token -- never falls through to a
 * handler with `request.userId` unset.
 */
export function requireAuth(verifier: AuthVerifier) {
  return async function requireAuthHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ error: "UNAUTHENTICATED", message: "Missing bearer token." });
      return;
    }
    const result = await verifier.verify(token);
    if (!result) {
      reply.code(401).send({ error: "UNAUTHENTICATED", message: "Invalid or expired token." });
      return;
    }
    request.userId = result.userId;
  };
}

/**
 * WebSocket variant of `requireAuth` for `/ws/portfolio` and `/ws/orders`
 * (CLAUDE.md section 28/40): a browser `WebSocket` client cannot set a
 * custom `Authorization` header on the upgrade request, so the token is
 * passed as a `?token=` query-string parameter instead -- a documented
 * choice (the alternative, authenticating via a post-connect first
 * message, would mean briefly holding an open, unauthenticated socket and
 * more state to track before the first real message; a query param lets
 * this reuse the exact same `preHandler` mechanism as every REST route,
 * rejecting the upgrade itself with a normal HTTP 401 before any socket is
 * ever established). Runs as a normal Fastify `preHandler` on the route
 * (fastify still runs its full hook chain before `@fastify/websocket`
 * hijacks the connection), so an invalid/missing token gets a plain HTTP
 * 401 response and the WebSocket upgrade never completes.
 */
export function requireAuthFromQueryToken(verifier: AuthVerifier) {
  return async function requireAuthWsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const query = request.query as Record<string, unknown>;
    const token = typeof query.token === "string" ? query.token : null;
    if (!token) {
      reply.code(401).send({ error: "UNAUTHENTICATED", message: "Missing ?token= query parameter." });
      return;
    }
    const result = await verifier.verify(token);
    if (!result) {
      reply.code(401).send({ error: "UNAUTHENTICATED", message: "Invalid or expired token." });
      return;
    }
    request.userId = result.userId;
  };
}
