import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { getMarketCountdown } from "@grokpulse/redis";
import { orderRowToOrder, type FillEvent, type OrderEvent } from "@grokpulse/trading-engine";
import type { WsMessage } from "@grokpulse/types";
import type { AppDeps } from "../deps.js";
import { requireAuthFromQueryToken } from "../auth/middleware.js";
import { isMarketTickEvent, isOrderBookUpdateEvent } from "../ws/market-events.js";
import { buildPortfolio } from "../lib/portfolio.js";

function safeSend(socket: WebSocket, message: WsMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A send failure means the socket is going away; the 'close' handler
    // (registered by each route below) is what unsubscribes -- nothing
    // further to do here.
  }
}

function connectionStatusMessage(timestamp: string): WsMessage {
  return { type: "CONNECTION_STATUS", timestamp, status: "CONNECTED" };
}

/**
 * `/ws/markets`, `/ws/portfolio`, `/ws/orders`, `/ws/signals` (CLAUDE.md
 * section 28). Every route subscribes to `deps.broadcasters.*` (shared,
 * process-wide stream consumers -- see `lib/stream-broadcaster.ts` for the
 * fan-out design and its documented tradeoff) and forwards normalized
 * `WsMessage`-shaped JSON. `/ws/portfolio` and `/ws/orders` require the
 * authenticated `userId` (via `?token=`, see
 * `auth/middleware.ts`'s `requireAuthFromQueryToken`) and filter events to
 * that user's own data only -- never broadcasting one user's order/
 * portfolio events to another connected client.
 */
export function registerWsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/ws/markets", { websocket: true }, (socket: WebSocket) => {
    const now = deps.now ? deps.now() : new Date();
    safeSend(socket, connectionStatusMessage(now.toISOString()));

    const unsubscribe = deps.broadcasters.market.subscribe((event) => {
      void (async () => {
        if (isMarketTickEvent(event)) {
          const tick = event.tick;
          deps.metrics.marketUpdatesTotal.inc({ marketId: tick.marketId });
          const countdown = await getMarketCountdown(deps.redis, tick.marketId).catch(() => null);
          safeSend(socket, {
            type: "MARKET_UPDATE",
            marketId: tick.marketId,
            timestamp: tick.timestamp,
            data: {
              yesBid: tick.yesBid,
              yesAsk: tick.yesAsk,
              noBid: tick.noBid,
              noAsk: tick.noAsk,
              // Fail closed on a missing countdown rather than fabricating a
              // positive number: 0 reads as "unknown/expired", never as
              // "plenty of time left".
              timeRemainingSeconds: countdown ? countdown.timeRemainingSeconds : 0,
            },
          });
        } else if (isOrderBookUpdateEvent(event)) {
          safeSend(socket, {
            type: "ORDERBOOK_UPDATE",
            marketId: event.marketId,
            timestamp: event.summary.timestamp,
          });
        }
        // Other event types on market.events (MARKET_DISCOVERED,
        // MARKET_LIFECYCLE_CHANGED, TRADE) have no WsMessage variant in
        // @grokpulse/types today -- intentionally not forwarded, see
        // ws/market-events.ts.
      })();
    });

    socket.on("close", unsubscribe);
  });

  app.get("/ws/signals", { websocket: true }, (socket: WebSocket) => {
    const now = deps.now ? deps.now() : new Date();
    safeSend(socket, connectionStatusMessage(now.toISOString()));

    // signal.events is already published in exactly the SignalUpdateMessage
    // shape (see services/signal-engine's SignalEngine.run, step 7) --
    // forwarded verbatim, no mapping needed.
    const unsubscribe = deps.broadcasters.signal.subscribe((signalMessage) => {
      safeSend(socket, signalMessage);
    });

    socket.on("close", unsubscribe);
  });

  app.get(
    "/ws/orders",
    { websocket: true, preHandler: requireAuthFromQueryToken(deps.authVerifier) },
    (socket: WebSocket, request) => {
      const userId = request.userId!;
      const now = deps.now ? deps.now() : new Date();
      safeSend(socket, connectionStatusMessage(now.toISOString()));

      const unsubscribeOrders = deps.broadcasters.order.subscribe((event: OrderEvent) => {
        if (event.order.userId !== userId) return; // never leak another user's orders
        safeSend(socket, { type: "ORDER_UPDATE", timestamp: event.order.updatedAt, order: event.order });
      });

      // fill.events carries no userId directly (Fill only has orderId) --
      // resolved via a lookup against the order it belongs to. There is no
      // WsMessage variant for a bare fill (see routes/ws.ts's header /
      // deps.ts doc comment on AppBroadcasters), so a fill is surfaced here
      // as a fresh ORDER_UPDATE for the order it filled against, which is
      // the state change a client watching /ws/orders actually cares about.
      const unsubscribeFills = deps.broadcasters.fill.subscribe((event: FillEvent) => {
        void (async () => {
          const orderRow = await deps.repos.orders.findById(event.fill.orderId).catch(() => undefined);
          if (!orderRow || orderRow.userId !== userId) return;
          safeSend(socket, {
            type: "ORDER_UPDATE",
            timestamp: orderRow.updatedAt.toISOString(),
            order: orderRowToOrder(orderRow, "PAPER"),
          });
        })();
      });

      socket.on("close", () => {
        unsubscribeOrders();
        unsubscribeFills();
      });
    },
  );

  app.get(
    "/ws/portfolio",
    { websocket: true, preHandler: requireAuthFromQueryToken(deps.authVerifier) },
    (socket: WebSocket, request) => {
      const userId = request.userId!;
      const now = deps.now ? deps.now() : new Date();
      safeSend(socket, connectionStatusMessage(now.toISOString()));

      const pushPortfolio = () => {
        void (async () => {
          const portfolio = await buildPortfolio(userId, "PAPER", deps.repos, deps.now ? deps.now() : new Date());
          safeSend(socket, {
            type: "PORTFOLIO_UPDATE",
            timestamp: new Date().toISOString(),
            portfolio,
          });
        })();
      };

      const unsubscribeOrders = deps.broadcasters.order.subscribe((event: OrderEvent) => {
        if (event.order.userId !== userId) return;
        pushPortfolio();
      });
      const unsubscribeFills = deps.broadcasters.fill.subscribe((event: FillEvent) => {
        void (async () => {
          const orderRow = await deps.repos.orders.findById(event.fill.orderId).catch(() => undefined);
          if (!orderRow || orderRow.userId !== userId) return;
          pushPortfolio();
        })();
      });

      socket.on("close", () => {
        unsubscribeOrders();
        unsubscribeFills();
      });
    },
  );
}
