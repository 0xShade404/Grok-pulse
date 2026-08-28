import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrderTicket } from "@/components/OrderTicket";
import { useAuthStore } from "@/lib/stores/authStore";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let walletClientData: unknown = undefined;
vi.mock("wagmi", () => ({
  useWalletClient: () => ({ data: walletClientData }),
}));

const submitLiveTradeMock = vi.fn();
vi.mock("@/lib/live-order", () => ({
  submitLiveTrade: (...args: unknown[]) => submitLiveTradeMock(...args),
}));

function futureIso(msFromNow = 60_000): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

/**
 * Covers CLAUDE.md section 22's gate ordering for the LIVE TRADE button:
 * logged in -> verified wallet -> live trading enabled -> ready. Each test
 * satisfies one fewer gate than the last so the disabled state (and its
 * reason) is attributable to the gate under test, not an earlier one.
 */
describe("OrderTicket LIVE TRADE button", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    walletClientData = undefined;
    submitLiveTradeMock.mockReset();
  });

  function liveButton() {
    return screen.getByRole("button", { name: /live trade/i });
  }

  it("is disabled when not logged in", () => {
    render(<OrderTicket marketId="mkt_1" restriction="NORMAL" />);
    expect(liveButton()).toBeDisabled();
  });

  it("is disabled when logged in but no verified wallet is linked", () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "tok",
      expiresAt: futureIso(),
    });
    render(<OrderTicket marketId="mkt_1" restriction="NORMAL" />);
    expect(liveButton()).toBeDisabled();
  });

  it("is disabled when the wallet is linked but not yet verified", () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "tok",
      expiresAt: futureIso(),
    });
    useAuthStore.getState().setWallet({ address: "0xabc", verified: false });
    render(<OrderTicket marketId="mkt_1" restriction="NORMAL" />);
    expect(liveButton()).toBeDisabled();
  });

  it("is disabled when the wallet is verified but live trading is not enabled", () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "tok",
      expiresAt: futureIso(),
    });
    useAuthStore.getState().setWallet({ address: "0xabc", verified: true });
    render(<OrderTicket marketId="mkt_1" restriction="NORMAL" />);
    expect(liveButton()).toBeDisabled();
  });

  it("is disabled when every account gate passes but new entries are restricted this close to expiry", () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "tok",
      expiresAt: futureIso(),
    });
    useAuthStore.getState().setWallet({ address: "0xabc", verified: true });
    useAuthStore.getState().setLiveTradingEnabled(true);
    render(<OrderTicket marketId="mkt_1" restriction="ENTRY_DISABLED" />);
    expect(liveButton()).toBeDisabled();
  });

  it("is enabled once logged in + verified wallet + live trading enabled + entries allowed, and submits on click", async () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "tok",
      expiresAt: futureIso(),
    });
    useAuthStore.getState().setWallet({ address: "0xabc", verified: true });
    useAuthStore.getState().setLiveTradingEnabled(true);
    walletClientData = { account: { address: "0xabc" } };
    submitLiveTradeMock.mockResolvedValue({
      status: "SUBMITTED",
      response: { orderId: "ord_1", status: "submitted" },
    });

    render(<OrderTicket marketId="mkt_1" suggestedPrice={0.6} restriction="NORMAL" />);
    expect(liveButton()).toBeEnabled();

    fireEvent.click(liveButton());

    await waitFor(() => expect(submitLiveTradeMock).toHaveBeenCalledTimes(1));
    expect(submitLiveTradeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: "mkt_1",
        side: "YES",
        price: 0.6,
        sizeUsd: 10,
        walletClient: walletClientData,
      }),
    );

    expect(await screen.findByText(/ord_1 submitted/i)).toBeInTheDocument();
  });

  it("shows a declined-signature result without crashing, and lets the user retry", async () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "tok",
      expiresAt: futureIso(),
    });
    useAuthStore.getState().setWallet({ address: "0xabc", verified: true });
    useAuthStore.getState().setLiveTradingEnabled(true);
    walletClientData = { account: { address: "0xabc" } };
    submitLiveTradeMock.mockResolvedValue({ status: "SIGNATURE_DECLINED" });

    render(<OrderTicket marketId="mkt_1" restriction="NORMAL" />);
    fireEvent.click(liveButton());

    expect(await screen.findByText(/you declined the wallet signature/i)).toBeInTheDocument();
    // Button becomes ready again -- the user can retry without reloading.
    await waitFor(() => expect(liveButton()).toBeEnabled());
  });
});
