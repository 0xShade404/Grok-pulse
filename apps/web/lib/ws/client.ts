import type { WsMessage } from "@grokpulse/types";
import { useMarketStore } from "@/lib/stores/marketStore";
import { useSignalStore } from "@/lib/stores/signalStore";
import { useOrderStore } from "@/lib/stores/orderStore";
import { usePortfolioStore } from "@/lib/stores/portfolioStore";
import type { GrokPulseWsClient, WsConnectionState } from "@/lib/ws/types";

/**
 * Apply one authoritative `WsMessage` to the Zustand stores. This is the
 * single dispatch point real WebSocket frames (`/ws/markets`,
 * `/ws/portfolio`, `/ws/orders`, `/ws/signals`) will flow through once
 * services/market-stream exists -- kept here, typed against the exact
 * shared union, so wiring the real client later is a no-op for every
 * component that reads from the stores.
 */
export function dispatchWsMessage(message: WsMessage): void {
  switch (message.type) {
    case "MARKET_UPDATE": {
      const market = useMarketStore.getState().markets[message.marketId];
      if (market) {
        useMarketStore.getState().setTick({
          marketId: message.marketId,
          timestamp: message.timestamp,
          yesBid: message.data.yesBid,
          yesAsk: message.data.yesAsk,
          noBid: message.data.noBid,
          noAsk: message.data.noAsk,
          yesMid: (message.data.yesBid + message.data.yesAsk) / 2,
          noMid: (message.data.noBid + message.data.noAsk) / 2,
          volume: 0,
        });
      }
      break;
    }
    case "ORDERBOOK_UPDATE":
      // Real payload carries the book itself server-side; the browser only
      // ever consumes the normalized book, never raw Polymarket frames
      // (CLAUDE.md section 7).
      break;
    case "SIGNAL_UPDATE":
      useSignalStore.getState().setSignal(message.marketId, message.signal);
      break;
    case "ORDER_UPDATE":
      useOrderStore.getState().upsertOrder(message.order);
      break;
    case "PORTFOLIO_UPDATE":
      usePortfolioStore.getState().setPortfolio(message.portfolio);
      break;
    case "CONNECTION_STATUS":
      // Handled by the client's own `state`, surfaced via useWsConnectionState().
      break;
  }
}

/**
 * Phase 1 stub: this environment has no backend to connect to yet
 * (CLAUDE.md section 81 -- "Phase 1: terminal UI ... No trading"). The real
 * implementation will open a WebSocket to the future market-data service
 * and call `dispatchWsMessage` for every frame; until then this
 * intentionally no-ops so `ConnectionStatus` honestly reports
 * DISCONNECTED rather than fabricating a live connection.
 */
class StubWsClient implements GrokPulseWsClient {
  state: WsConnectionState = "DISCONNECTED";
  private listeners = new Set<(message: WsMessage) => void>();

  connect(): void {
    console.info(
      "[ws] Phase 1 stub client: no backend configured, staying DISCONNECTED.",
    );
  }

  disconnect(): void {
    this.state = "DISCONNECTED";
  }

  subscribe(listener: (message: WsMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const wsClient: GrokPulseWsClient = new StubWsClient();
