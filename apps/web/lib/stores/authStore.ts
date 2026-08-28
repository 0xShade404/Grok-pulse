import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Real account/session state (CLAUDE.md section 40: authenticated endpoints
 * resolve `userId` server-side from this bearer token -- the frontend never
 * invents or overrides it). Distinct from `settingsStore`, which holds
 * Phase-1 LOCAL/MOCK display toggles (`liveTradingEnabled` there is
 * explicitly documented as never wired to a backend). The fields below are
 * the real, server-confirmed account state this task wires up.
 *
 * --- Token storage tradeoff (read before changing this file) ---------------
 * The access token is kept in this in-memory Zustand store AND mirrored to
 * `localStorage` so a page reload doesn't force a re-login. This is a
 * deliberate, known-imperfect choice for a lightweight bearer-token API
 * with no shared-origin cookie infrastructure between `apps/web` (Vercel)
 * and `apps/api` (ECS/Fargate, a different origin) -- an httpOnly cookie
 * set by the API would not simply work here without a same-site proxy/BFF
 * layer neither app currently has.
 *
 * The real risk: `localStorage` is readable by any JS running on this
 * origin, so a successful XSS (e.g. via a compromised dependency or an
 * unsanitized render path) can exfiltrate the token, not just deface the
 * page. Mitigations already in place: the token is short-lived
 * (`AuthSession.expiresAt`, checked below), the API is expected to scope it
 * narrowly (per-user, not a master credential), and this is a bearer token
 * for a REST API -- never a wallet private key, which never touches this
 * store or `localStorage` at all (that stays entirely inside the browser
 * wallet extension, see `lib/wagmi/config.ts`). A production hardening pass
 * should move to httpOnly cookies via a same-origin proxy/BFF if/when
 * `apps/web` and `apps/api` are put behind one domain.
 */

export interface AuthUser {
  userId: string;
  username: string;
}

export interface LinkedWallet {
  address: string;
  verified: boolean;
}

interface AuthStoreState {
  user: AuthUser | null;
  accessToken: string | null;
  expiresAt: string | null;

  /** Non-custodial linked wallet + its SIWE-style verification status
   * (CLAUDE.md section 22-23). Populated by the account page's link flow. */
  wallet: LinkedWallet | null;
  setWallet: (wallet: LinkedWallet | null) => void;

  /** Server-confirmed live-trading opt-in state (CLAUDE.md section 22). This
   * is the REAL gate `OrderTicket` checks -- not `settingsStore`'s mock
   * flag. */
  liveTradingEnabled: boolean;
  setLiveTradingEnabled: (enabled: boolean) => void;

  login: (session: { userId: string; username: string; accessToken: string; expiresAt: string }) => void;
  logout: () => void;

  /** True once the token is present and not past `expiresAt`. Does not
   * verify the signature (only the server can) -- this is a cheap client-
   * side check to avoid sending an obviously-expired token. */
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthStoreState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      expiresAt: null,
      wallet: null,
      liveTradingEnabled: false,

      setWallet: (wallet) => set({ wallet }),
      setLiveTradingEnabled: (enabled) => set({ liveTradingEnabled: enabled }),

      login: ({ userId, username, accessToken, expiresAt }) =>
        set({
          user: { userId, username },
          accessToken,
          expiresAt,
          // A fresh login starts from a clean slate for wallet/live-trading
          // status -- the account page re-fetches the authoritative values
          // rather than trusting whatever a previous session happened to
          // have stored, in case they've changed server-side.
          wallet: null,
          liveTradingEnabled: false,
        }),

      logout: () =>
        set({ user: null, accessToken: null, expiresAt: null, wallet: null, liveTradingEnabled: false }),

      isAuthenticated: () => {
        const { accessToken, expiresAt } = get();
        if (!accessToken) return false;
        if (!expiresAt) return true;
        return new Date(expiresAt).getTime() > Date.now();
      },
    }),
    {
      name: "grokpulse-auth",
      storage: createJSONStorage(() => localStorage),
      // Never persist wallet/live-trading status across reloads as fact --
      // only the session identity/token. The account page re-fetches
      // wallet+live-trading state fresh on mount (server-authoritative,
      // CLAUDE.md section 91), so a stale cached "verified"/"enabled" flag
      // can never be shown as true when the server would say otherwise.
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        expiresAt: state.expiresAt,
      }),
    },
  ),
);
