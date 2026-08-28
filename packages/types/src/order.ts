import { z } from "zod";
import { OrderBookSideSchema } from "./orderbook.js";

export const TradingModeSchema = z.enum(["PAPER", "LIVE"]);
export type TradingMode = z.infer<typeof TradingModeSchema>;

/** Order lifecycle (CLAUDE.md section 21). */
export const OrderStatusSchema = z.enum([
  "created",
  "validated",
  "signed",
  "submitted",
  "live",
  "partially_filled",
  "filled",
  "rejected",
  "cancelled",
  "expired",
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  "filled",
  "rejected",
  "cancelled",
  "expired",
];

export const OrderRequestSchema = z.object({
  clientOrderId: z.string().min(1),
  userId: z.string(),
  marketId: z.string(),
  mode: TradingModeSchema,
  side: OrderBookSideSchema,
  price: z.number().min(0).max(1),
  sizeUsd: z.number().positive(),
  maxSlippage: z.number().min(0).max(1),
  signalId: z.string().nullable(),
  strategyVersion: z.string(),
});
export type OrderRequest = z.infer<typeof OrderRequestSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  marketId: z.string(),
  clientOrderId: z.string(),
  exchangeOrderId: z.string().nullable(),
  mode: TradingModeSchema,
  side: OrderBookSideSchema,
  price: z.number().min(0).max(1),
  sizeUsd: z.number().positive(),
  status: OrderStatusSchema,
  submittedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type Order = z.infer<typeof OrderSchema>;

export const FillSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  price: z.number().min(0).max(1),
  size: z.number().nonnegative(),
  fee: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});
export type Fill = z.infer<typeof FillSchema>;

export const OrderResultSchema = z.object({
  order: OrderSchema,
  fills: z.array(FillSchema),
});
export type OrderResult = z.infer<typeof OrderResultSchema>;

export const PositionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  marketId: z.string(),
  side: OrderBookSideSchema,
  size: z.number().nonnegative(),
  averagePrice: z.number().min(0).max(1),
  realizedPnl: z.number(),
  unrealizedPnl: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

export const PortfolioSnapshotSchema = z.object({
  id: z.string(),
  userId: z.string(),
  timestamp: z.string().datetime(),
  balance: z.number(),
  equity: z.number(),
  pnl: z.number(),
});
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>;

export const PortfolioSchema = z.object({
  userId: z.string(),
  mode: TradingModeSchema,
  balanceUsd: z.number(),
  equityUsd: z.number(),
  todayPnlUsd: z.number(),
  totalPnlUsd: z.number(),
  openPositions: z.array(PositionSchema),
});
export type Portfolio = z.infer<typeof PortfolioSchema>;
