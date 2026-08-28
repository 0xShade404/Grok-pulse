import type { WsMessage } from "@grokpulse/types";

export type WsConnectionState = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "CONNECTING";

/**
 * The client-side contract a real WebSocket client (`/ws/markets`,
 * `/ws/portfolio`, `/ws/orders`, `/ws/signals` -- CLAUDE.md section 28) will
 * fulfill. `lib/ws/client.ts` implements this as a no-op stub for Phase 1;
 * a later services/market-stream integration swaps the implementation
 * without touching any component.
 */
export interface GrokPulseWsClient {
  readonly state: WsConnectionState;
  connect(): void;
  disconnect(): void;
  subscribe(listener: (message: WsMessage) => void): () => void;
}
