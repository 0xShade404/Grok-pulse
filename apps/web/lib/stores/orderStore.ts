import { create } from "zustand";
import type { Order } from "@grokpulse/types";

/**
 * Order lifecycle state (CLAUDE.md section 21). In Phase 1 there is no
 * order manager to submit to -- the order ticket is display-only and any
 * "submission" a user triggers is a local, clearly-labeled simulation, not
 * a real order (see components/OrderTicket.tsx).
 */
interface OrderStoreState {
  ordersById: Record<string, Order>;
  upsertOrder: (order: Order) => void;
}

export const useOrderStore = create<OrderStoreState>((set) => ({
  ordersById: {},
  upsertOrder: (order) =>
    set((state) => ({ ordersById: { ...state.ordersById, [order.id]: order } })),
}));
