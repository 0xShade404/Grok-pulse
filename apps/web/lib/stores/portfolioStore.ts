import { create } from "zustand";
import type { Portfolio } from "@grokpulse/types";

interface PortfolioStoreState {
  portfolio: Portfolio | null;
  setPortfolio: (portfolio: Portfolio) => void;
}

export const usePortfolioStore = create<PortfolioStoreState>((set) => ({
  portfolio: null,
  setPortfolio: (portfolio) => set({ portfolio }),
}));
