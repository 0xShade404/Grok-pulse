import { http, createConfig } from "wagmi";
import { polygon } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

/**
 * Non-custodial wallet connection (CLAUDE.md section 22-23). GrokPulse never
 * holds a private key -- wagmi only gives the app read access to whichever
 * address the browser wallet exposes, plus the ability to ask that wallet to
 * sign messages/orders. All signing prompts happen inside the wallet
 * extension itself; the key never reaches this app's JS runtime.
 *
 * Chain: Polygon only (137), matching `POLYMARKET_CHAIN_ID` in
 * `.env.example` -- Polymarket's CLOB only settles on Polygon, so every
 * other chain is out of scope for this app.
 *
 * Connectors:
 *   - `injected()` -- MetaMask and any other EIP-1193 browser-extension
 *     wallet. Zero external services required, works fully offline/in this
 *     sandbox.
 *   - `walletConnect(...)` -- only registered when
 *     `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set. WalletConnect requires
 *     a real project id issued by WalletConnect Cloud (https://cloud.reown.com);
 *     no such id exists in this sandbox, and one must never be fabricated
 *     (CLAUDE.md section 89: no hard-coded/fake credentials). Leaving the
 *     env var unset makes this connector simply not register -- the app
 *     falls back to injected-only wallet connection, which is a complete,
 *     working non-custodial flow on its own for any MetaMask-style wallet.
 */
const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const connectors = [
  injected(),
  ...(WALLETCONNECT_PROJECT_ID
    ? [walletConnect({ projectId: WALLETCONNECT_PROJECT_ID, showQrModal: true })]
    : []),
];

export const wagmiConfig = createConfig({
  chains: [polygon],
  connectors,
  transports: {
    [polygon.id]: http(),
  },
  ssr: true,
});

export const POLYGON_CHAIN_ID = polygon.id;

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
