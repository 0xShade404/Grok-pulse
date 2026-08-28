import type { FundingChecker } from "../lib/funding-checker.js";

/** Controllable `FundingChecker` fake. Defaults to always-unfunded --
 * matching production's fail-closed default when `POLYGON_RPC_URL`/
 * `POLYGON_USDC_ADDRESS` are unset -- so a test must opt in to "funded"
 * explicitly, the same way a real deployment must opt in to configuring
 * those env vars. */
export class FakeFundingChecker implements FundingChecker {
  calls: Array<{ address: string; requiredUsd: number }> = [];

  constructor(private readonly funded: boolean = false) {}

  async isFunded(address: string, requiredUsd: number): Promise<boolean> {
    this.calls.push({ address, requiredUsd });
    return this.funded;
  }
}
