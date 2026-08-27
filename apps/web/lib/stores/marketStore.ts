import { create } from "zustand";
import type { Market, MarketCountdown, MarketTick } from "@grokpulse/types";

/**
 * Live market state (CLAUDE.md section 29). Populated initially by
 * TanStack Query (`lib/api/markets.ts`) and kept current by
 * `MARKET_UPDATE` / countdown pushes from `lib/ws/client.ts` once a real
 * WebSocket exists. The browser never computes this from scratch --
 * it only ever applies updates the backend sent.
 */
interface MarketStoreState {
  markets: Record<string, Market>;
  countdowns: Record<string, MarketCountdown>;
  ticks: Record<string, MarketTick>;

  setMarkets: (markets: Market[]) => void;
  upsertMarket: (market: Market) => void;
  setCountdown: (countdown: MarketCountdown) => void;
  setTick: (tick: MarketTick) => void;
}

export const useMarketStore = create<MarketStoreState>((set) => ({
  markets: {},
  countdowns: {},
  ticks: {},

  setMarkets: (markets) =>
    set(() => ({
      markets: Object.fromEntries(markets.map((m) => [m.id, m])),
    })),

  upsertMarket: (market) =>
    set((state) => ({ markets: { ...state.markets, [market.id]: market } })),

  setCountdown: (countdown) =>
    set((state) => ({
      countdowns: { ...state.countdowns, [countdown.marketId]: countdown },
    })),

  setTick: (tick) =>
    set((state) => ({ ticks: { ...state.ticks, [tick.marketId]: tick } })),
}));
