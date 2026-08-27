import { create } from "zustand";

/**
 * User-facing settings and admin-style mock controls.
 *
 * IMPORTANT: `liveTradingEnabled` and `killSwitchEngaged` here are LOCAL,
 * MOCK, DISPLAY-ONLY state (CLAUDE.md section 90/91) -- Phase 1 has no
 * backend, so nothing in this store actually enables live trading or halts
 * a real system. Per CLAUDE.md section 91, trading mode must ultimately be
 * server-authoritative; this store exists only so the /admin and /terminal
 * mock controls have somewhere to write their (clearly labeled) local
 * toggles for demo purposes.
 */
interface SettingsStoreState {
  disclaimerDismissed: boolean;
  dismissDisclaimer: () => void;

  /** Always false in Phase 1 -- there is no live trading path to enable. */
  liveTradingEnabled: boolean;

  /** Local mock kill switch -- see components/KillSwitch.tsx. */
  killSwitchEngaged: boolean;
  setKillSwitchEngaged: (engaged: boolean) => void;

  strategyEnabled: boolean;
  setStrategyEnabled: (enabled: boolean) => void;

  assetsEnabled: { BTC: boolean; ETH: boolean };
  setAssetEnabled: (asset: "BTC" | "ETH", enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  disclaimerDismissed: false,
  dismissDisclaimer: () => set({ disclaimerDismissed: true }),

  liveTradingEnabled: false,

  killSwitchEngaged: false,
  setKillSwitchEngaged: (engaged) => set({ killSwitchEngaged: engaged }),

  strategyEnabled: true,
  setStrategyEnabled: (enabled) => set({ strategyEnabled: enabled }),

  assetsEnabled: { BTC: true, ETH: true },
  setAssetEnabled: (asset, enabled) =>
    set((state) => ({
      assetsEnabled: { ...state.assetsEnabled, [asset]: enabled },
    })),
}));
