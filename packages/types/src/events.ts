import { z } from "zod";
import { AgentSignalSchema } from "./signal.js";
import { OrderSchema } from "./order.js";
import { PortfolioSchema } from "./order.js";

/** Typed WebSocket message envelope for /ws/markets (CLAUDE.md section 28). */
export const MarketUpdateMessageSchema = z.object({
  type: z.literal("MARKET_UPDATE"),
  marketId: z.string(),
  timestamp: z.string().datetime(),
  data: z.object({
    yesBid: z.number().min(0).max(1),
    yesAsk: z.number().min(0).max(1),
    noBid: z.number().min(0).max(1),
    noAsk: z.number().min(0).max(1),
    timeRemainingSeconds: z.number(),
  }),
});
export type MarketUpdateMessage = z.infer<typeof MarketUpdateMessageSchema>;

export const OrderBookUpdateMessageSchema = z.object({
  type: z.literal("ORDERBOOK_UPDATE"),
  marketId: z.string(),
  timestamp: z.string().datetime(),
});
export type OrderBookUpdateMessage = z.infer<typeof OrderBookUpdateMessageSchema>;

export const SignalUpdateMessageSchema = z.object({
  type: z.literal("SIGNAL_UPDATE"),
  marketId: z.string(),
  timestamp: z.string().datetime(),
  signal: AgentSignalSchema,
});
export type SignalUpdateMessage = z.infer<typeof SignalUpdateMessageSchema>;

export const OrderUpdateMessageSchema = z.object({
  type: z.literal("ORDER_UPDATE"),
  timestamp: z.string().datetime(),
  order: OrderSchema,
});
export type OrderUpdateMessage = z.infer<typeof OrderUpdateMessageSchema>;

export const PortfolioUpdateMessageSchema = z.object({
  type: z.literal("PORTFOLIO_UPDATE"),
  timestamp: z.string().datetime(),
  portfolio: PortfolioSchema,
});
export type PortfolioUpdateMessage = z.infer<typeof PortfolioUpdateMessageSchema>;

export const ConnectionStatusMessageSchema = z.object({
  type: z.literal("CONNECTION_STATUS"),
  timestamp: z.string().datetime(),
  status: z.enum(["CONNECTED", "DEGRADED", "DISCONNECTED"]),
  details: z.string().optional(),
});
export type ConnectionStatusMessage = z.infer<typeof ConnectionStatusMessageSchema>;

export const WsMessageSchema = z.discriminatedUnion("type", [
  MarketUpdateMessageSchema,
  OrderBookUpdateMessageSchema,
  SignalUpdateMessageSchema,
  OrderUpdateMessageSchema,
  PortfolioUpdateMessageSchema,
  ConnectionStatusMessageSchema,
]);
export type WsMessage = z.infer<typeof WsMessageSchema>;

/** Redis Stream names (CLAUDE.md section 25). */
export const REDIS_STREAMS = {
  marketEvents: "market.events",
  underlyingEvents: "underlying.events",
  signalEvents: "signal.events",
  orderEvents: "order.events",
  fillEvents: "fill.events",
  riskEvents: "risk.events",
} as const;
export type RedisStreamName = (typeof REDIS_STREAMS)[keyof typeof REDIS_STREAMS];
