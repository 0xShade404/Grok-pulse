import { create } from "zustand";

/** UI-only terminal layout state -- nothing here is domain data, it never
 * needs to survive a page reload authoritatively (CLAUDE.md section 29). */
interface TerminalStoreState {
  selectedMarketId: string | null;
  orderTicketSide: "YES" | "NO";
  setSelectedMarketId: (marketId: string) => void;
  setOrderTicketSide: (side: "YES" | "NO") => void;
}

export const useTerminalStore = create<TerminalStoreState>((set) => ({
  selectedMarketId: null,
  orderTicketSide: "YES",
  setSelectedMarketId: (marketId) => set({ selectedMarketId: marketId }),
  setOrderTicketSide: (side) => set({ orderTicketSide: side }),
}));
