import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { tradingRestrictionForTimeRemaining, type MarketCountdown } from "@grokpulse/types";
import { Countdown } from "@/components/Countdown";

function countdownFor(timeRemainingSeconds: number): MarketCountdown {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    marketId: "mkt_test",
    serverNow: now.toISOString(),
    marketEndTime: new Date(now.getTime() + timeRemainingSeconds * 1000).toISOString(),
    timeRemainingSeconds,
    // Reuse the canonical tier rule from @grokpulse/types -- this is the
    // exact same function the Countdown component relies on, so this test
    // asserts the component renders whatever that shared rule says.
    tradingRestriction: tradingRestrictionForTimeRemaining(timeRemainingSeconds),
  };
}

describe("Countdown", () => {
  it("renders the NORMAL tier above 60 seconds", () => {
    render(<Countdown countdown={countdownFor(120)} />);
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("2:00")).toBeInTheDocument();
  });

  it("renders RESTRICTED_ENTRY at exactly 60 seconds", () => {
    render(<Countdown countdown={countdownFor(60)} />);
    expect(screen.getByText("Restricted entry")).toBeInTheDocument();
  });

  it("renders ENTRY_DISABLED at 20 seconds", () => {
    render(<Countdown countdown={countdownFor(20)} />);
    expect(screen.getByText("Entry disabled")).toBeInTheDocument();
  });

  it("renders CANCEL_RESTING_ORDERS at 5 seconds", () => {
    render(<Countdown countdown={countdownFor(5)} />);
    expect(screen.getByText("Cancelling orders")).toBeInTheDocument();
  });

  it("renders STOPPED at 0 seconds and never shows a negative time", () => {
    render(<Countdown countdown={countdownFor(0)} />);
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });
});
