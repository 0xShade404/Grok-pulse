import { describe, expect, it, beforeEach } from "vitest";
import { useAuthStore } from "@/lib/stores/authStore";

function futureIso(msFromNow = 60_000): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

describe("authStore", () => {
  beforeEach(() => {
    useAuthStore.getState().logout();
    localStorage.clear();
  });

  it("starts logged out", () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.isAuthenticated()).toBe(false);
  });

  it("login populates the session and resets wallet/live-trading state", () => {
    // Simulate stale state from a previous session lingering before login.
    useAuthStore.getState().setWallet({ address: "0xabc", verified: true });
    useAuthStore.getState().setLiveTradingEnabled(true);

    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "token-123",
      expiresAt: futureIso(),
    });

    const state = useAuthStore.getState();
    expect(state.user).toEqual({ userId: "u1", username: "trader1" });
    expect(state.accessToken).toBe("token-123");
    expect(state.isAuthenticated()).toBe(true);
    // A fresh login must not carry over a previous session's wallet/live
    // trading status -- the account page re-fetches those fresh.
    expect(state.wallet).toBeNull();
    expect(state.liveTradingEnabled).toBe(false);
  });

  it("treats an expired token as not authenticated", () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "token-123",
      expiresAt: futureIso(-1000),
    });
    expect(useAuthStore.getState().isAuthenticated()).toBe(false);
  });

  it("logout clears the session, wallet, and live-trading state", () => {
    useAuthStore.getState().login({
      userId: "u1",
      username: "trader1",
      accessToken: "token-123",
      expiresAt: futureIso(),
    });
    useAuthStore.getState().setWallet({ address: "0xabc", verified: true });
    useAuthStore.getState().setLiveTradingEnabled(true);

    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.expiresAt).toBeNull();
    expect(state.wallet).toBeNull();
    expect(state.liveTradingEnabled).toBe(false);
    expect(state.isAuthenticated()).toBe(false);
  });

  it("setWallet and setLiveTradingEnabled update independently of login/logout", () => {
    useAuthStore.getState().setWallet({ address: "0xdef", verified: false });
    expect(useAuthStore.getState().wallet).toEqual({ address: "0xdef", verified: false });

    useAuthStore.getState().setWallet({ address: "0xdef", verified: true });
    expect(useAuthStore.getState().wallet?.verified).toBe(true);

    useAuthStore.getState().setLiveTradingEnabled(true);
    expect(useAuthStore.getState().liveTradingEnabled).toBe(true);
  });
});
