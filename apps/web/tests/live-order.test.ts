import { describe, expect, it, vi, beforeEach } from "vitest";
import type { WalletClient } from "viem";
import { ApiError } from "@/lib/api/client";
import type { PrepareLiveOrderResponse } from "@grokpulse/types";

const prepareLiveOrderMock = vi.fn();
const submitLiveOrderMock = vi.fn();
vi.mock("@/lib/api/auth", () => ({
  prepareLiveOrder: (...args: unknown[]) => prepareLiveOrderMock(...args),
  submitLiveOrder: (...args: unknown[]) => submitLiveOrderMock(...args),
}));

const createOrderMock = vi.fn();
const ClobClientMock = vi.fn().mockImplementation(() => ({ createOrder: createOrderMock }));
vi.mock("@polymarket/clob-client", () => ({
  ClobClient: ClobClientMock,
  Side: { BUY: "BUY", SELL: "SELL" },
}));

// Imported after the mocks above so `submitLiveTrade` picks up the mocked
// modules (vi.mock calls are hoisted, but the dynamic import ordering below
// keeps this file's intent explicit).
const { submitLiveTrade } = await import("@/lib/live-order");

function preparedResponse(overrides: Partial<PrepareLiveOrderResponse> = {}): PrepareLiveOrderResponse {
  return {
    preparedOrderId: "prep_1",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    walletAddress: "0xAbC0000000000000000000000000000000AbC0",
    chainId: 137,
    order: {
      tokenID: "token_yes_1",
      price: 0.6,
      size: 16.67,
      side: "BUY",
      feeRateBps: 0,
      tickSize: "0.01",
      negRisk: false,
    },
    ...overrides,
  };
}

function walletClientFor(address: string): WalletClient {
  return { account: { address } } as unknown as WalletClient;
}

describe("submitLiveTrade", () => {
  beforeEach(() => {
    prepareLiveOrderMock.mockReset();
    submitLiveOrderMock.mockReset();
    createOrderMock.mockReset();
    ClobClientMock.mockClear();
  });

  it("returns PREPARE_REJECTED when the server rejects preparation (risk engine, funding, etc.)", async () => {
    prepareLiveOrderMock.mockRejectedValue(
      new ApiError("Edge below minimum threshold.", 422, "/api/live/orders/prepare"),
    );

    const result = await submitLiveTrade({
      marketId: "mkt_1",
      side: "YES",
      price: 0.6,
      sizeUsd: 10,
      walletClient: walletClientFor("0xabc"),
    });

    expect(result).toEqual({ status: "PREPARE_REJECTED", reason: "Edge below minimum threshold." });
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(submitLiveOrderMock).not.toHaveBeenCalled();
  });

  it("returns WALLET_MISMATCH when the connected wallet differs from the server-verified linked wallet", async () => {
    prepareLiveOrderMock.mockResolvedValue(
      preparedResponse({ walletAddress: "0xAbC0000000000000000000000000000000AbC0" }),
    );

    const result = await submitLiveTrade({
      marketId: "mkt_1",
      side: "YES",
      price: 0.6,
      sizeUsd: 10,
      walletClient: walletClientFor("0xDifferentAddress00000000000000000000001"),
    });

    expect(result.status).toBe("WALLET_MISMATCH");
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it("returns SIGNATURE_DECLINED when the wallet rejects the signing prompt (EIP-1193 code 4001)", async () => {
    prepareLiveOrderMock.mockResolvedValue(preparedResponse());
    createOrderMock.mockRejectedValue({ code: 4001, message: "User rejected the request." });

    const result = await submitLiveTrade({
      marketId: "mkt_1",
      side: "YES",
      price: 0.6,
      sizeUsd: 10,
      walletClient: walletClientFor("0xAbC0000000000000000000000000000000AbC0"),
    });

    expect(result).toEqual({ status: "SIGNATURE_DECLINED" });
    expect(submitLiveOrderMock).not.toHaveBeenCalled();
  });

  it("returns SIGNING_FAILED for a non-rejection signing error", async () => {
    prepareLiveOrderMock.mockResolvedValue(preparedResponse());
    createOrderMock.mockRejectedValue(new Error("invalid price"));

    const result = await submitLiveTrade({
      marketId: "mkt_1",
      side: "YES",
      price: 0.6,
      sizeUsd: 10,
      walletClient: walletClientFor("0xAbC0000000000000000000000000000000AbC0"),
    });

    expect(result).toEqual({ status: "SIGNING_FAILED", message: "invalid price" });
  });

  it("builds the ClobClient and maps LiveOrderSdkParams -> UserOrder/CreateOrderOptions field-for-field, then submits on success", async () => {
    const prepared = preparedResponse();
    prepareLiveOrderMock.mockResolvedValue(prepared);
    const signedOrder = { signature: "0xsig" };
    createOrderMock.mockResolvedValue(signedOrder);
    submitLiveOrderMock.mockResolvedValue({ orderId: "ord_1", status: "submitted" });

    const walletClient = walletClientFor(prepared.walletAddress);
    const result = await submitLiveTrade({
      marketId: "mkt_1",
      side: "YES",
      price: 0.6,
      sizeUsd: 10,
      walletClient,
    });

    // ClobClient(host, chainId, signer) -- the wagmi WalletClient is passed
    // directly as the signer (ClobSigner = EthersSigner | WalletClient).
    expect(ClobClientMock).toHaveBeenCalledWith(
      expect.any(String),
      prepared.chainId,
      walletClient,
    );

    // UserOrder + CreateOrderOptions field mapping verified against the
    // installed @polymarket/clob-client's dist/types.d.ts.
    expect(createOrderMock).toHaveBeenCalledWith(
      {
        tokenID: prepared.order.tokenID,
        price: prepared.order.price,
        size: prepared.order.size,
        side: "BUY",
        feeRateBps: prepared.order.feeRateBps,
        taker: prepared.order.taker,
      },
      { tickSize: prepared.order.tickSize, negRisk: prepared.order.negRisk },
    );

    expect(submitLiveOrderMock).toHaveBeenCalledWith({
      preparedOrderId: prepared.preparedOrderId,
      signedOrder,
    });

    expect(result).toEqual({
      status: "SUBMITTED",
      response: { orderId: "ord_1", status: "submitted" },
    });
  });

  it("returns PREPARE_EXPIRED when submit fails with a 409/410 (prepared order no longer valid)", async () => {
    prepareLiveOrderMock.mockResolvedValue(preparedResponse());
    createOrderMock.mockResolvedValue({ signature: "0xsig" });
    submitLiveOrderMock.mockRejectedValue(new ApiError("Gone", 410, "/api/live/orders/submit"));

    const result = await submitLiveTrade({
      marketId: "mkt_1",
      side: "YES",
      price: 0.6,
      sizeUsd: 10,
      walletClient: walletClientFor("0xAbC0000000000000000000000000000000AbC0"),
    });

    expect(result).toEqual({ status: "PREPARE_EXPIRED" });
  });

  it("returns SUBMIT_FAILED for any other submit error", async () => {
    prepareLiveOrderMock.mockResolvedValue(preparedResponse());
    createOrderMock.mockResolvedValue({ signature: "0xsig" });
    submitLiveOrderMock.mockRejectedValue(new ApiError("Exchange unavailable.", 502, "/api/live/orders/submit"));

    const result = await submitLiveTrade({
      marketId: "mkt_1",
      side: "YES",
      price: 0.6,
      sizeUsd: 10,
      walletClient: walletClientFor("0xAbC0000000000000000000000000000000AbC0"),
    });

    expect(result).toEqual({ status: "SUBMIT_FAILED", message: "Exchange unavailable." });
  });
});
