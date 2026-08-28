import { create } from "zustand";
import type { AgentSignal } from "@grokpulse/types";

interface SignalStoreState {
  latestByMarket: Record<string, AgentSignal>;
  historyByMarket: Record<string, AgentSignal[]>;

  setSignal: (marketId: string, signal: AgentSignal) => void;
}

const MAX_HISTORY = 20;

export const useSignalStore = create<SignalStoreState>((set) => ({
  latestByMarket: {},
  historyByMarket: {},

  setSignal: (marketId, signal) =>
    set((state) => ({
      latestByMarket: { ...state.latestByMarket, [marketId]: signal },
      historyByMarket: {
        ...state.historyByMarket,
        [marketId]: [signal, ...(state.historyByMarket[marketId] ?? [])].slice(
          0,
          MAX_HISTORY,
        ),
      },
    })),
}));
