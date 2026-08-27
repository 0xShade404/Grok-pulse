import { create } from "zustand";
import type { OrderBook, RecentTrade } from "@grokpulse/types";

interface OrderBookStoreState {
  books: Record<string, OrderBook>;
  recentTrades: Record<string, RecentTrade[]>;

  setBook: (book: OrderBook) => void;
  setRecentTrades: (marketId: string, trades: RecentTrade[]) => void;
  addRecentTrade: (trade: RecentTrade) => void;
}

const MAX_RECENT_TRADES = 50;

export const useOrderBookStore = create<OrderBookStoreState>((set) => ({
  books: {},
  recentTrades: {},

  setBook: (book) =>
    set((state) => ({ books: { ...state.books, [book.marketId]: book } })),

  setRecentTrades: (marketId, trades) =>
    set((state) => ({
      recentTrades: { ...state.recentTrades, [marketId]: trades },
    })),

  addRecentTrade: (trade) =>
    set((state) => {
      const existing = state.recentTrades[trade.marketId] ?? [];
      return {
        recentTrades: {
          ...state.recentTrades,
          [trade.marketId]: [trade, ...existing].slice(0, MAX_RECENT_TRADES),
        },
      };
    }),
}));
