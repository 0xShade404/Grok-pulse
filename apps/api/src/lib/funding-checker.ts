import { createPublicClient, http, isAddress, type Address, type PublicClient } from "viem";
import { polygon } from "viem/chains";
import type { Logger } from "@grokpulse/logging";

/**
 * `account.funded` for a LIVE order (CLAUDE.md section 19's "account
 * funded" risk check). This system is non-custodial (CLAUDE.md section
 * 23) -- there is no server-tracked balance anywhere, so this MUST be a
 * real on-chain read, never a hardcoded `true`.
 *
 * FAIL-CLOSED DESIGN (CLAUDE.md section 56: "uncertain = do not trade"),
 * documented prominently because this is a safety-critical gate:
 *   - if `POLYGON_RPC_URL` or `POLYGON_USDC_ADDRESS` is unset, `isFunded`
 *     returns `false` -- never `true` -- so live trading is simply
 *     unavailable (every live order is rejected with
 *     `ACCOUNT_NOT_FUNDED`) until an operator configures both.
 *   - if the on-chain `balanceOf` read fails for ANY reason (RPC down,
 *     timeout, malformed response, wrong chain, contract call revert),
 *     `isFunded` returns `false`. It never assumes funded on error.
 *   - the exact current USDC contract address on Polygon PoS (bridged
 *     USDC.e vs. native USDC) has changed over Polymarket's history and
 *     cannot be verified from this sandbox -- see `POLYGON_USDC_ADDRESS`'s
 *     doc comment in `@grokpulse/config`. It is therefore a required,
 *     explicitly-configured value, never a hardcoded address this file
 *     "guesses" is still correct.
 */
export interface FundingChecker {
  /** Whether `address` holds at least `requiredUsd` of USDC (assumed
   * 6-decimal, the standard for both native and bridged USDC on Polygon).
   * Fails closed to `false` on any configuration gap or read failure --
   * see class doc comment. */
  isFunded(address: string, requiredUsd: number): Promise<boolean>;
}

const USDC_DECIMALS = 6;

/** Minimal ERC-20 ABI fragment -- only the one read this checker needs. */
const ERC20_BALANCE_OF_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface OnchainUsdcFundingCheckerConfig {
  /** From `@grokpulse/config`'s `POLYGON_RPC_URL`. Empty string means "not configured". */
  rpcUrl: string;
  /** From `@grokpulse/config`'s `POLYGON_USDC_ADDRESS`. Empty string means "not configured". */
  usdcAddress: string;
  logger?: Logger;
}

export class OnchainUsdcFundingChecker implements FundingChecker {
  private readonly client: PublicClient | null;
  private readonly usdcAddress: Address | null;
  private readonly logger?: Logger;

  constructor(config: OnchainUsdcFundingCheckerConfig) {
    this.logger = config.logger;
    const configured = config.rpcUrl.length > 0 && isAddress(config.usdcAddress);
    if (!configured) {
      this.client = null;
      this.usdcAddress = null;
      return;
    }
    this.usdcAddress = config.usdcAddress as Address;
    this.client = createPublicClient({ chain: polygon, transport: http(config.rpcUrl) });
  }

  async isFunded(address: string, requiredUsd: number): Promise<boolean> {
    if (!this.client || !this.usdcAddress) {
      // Not configured -- fail closed, never guess `true`.
      return false;
    }
    if (!isAddress(address)) {
      return false;
    }
    try {
      const balance = await this.client.readContract({
        address: this.usdcAddress,
        abi: ERC20_BALANCE_OF_ABI,
        functionName: "balanceOf",
        args: [address as Address],
      });
      const balanceUsd = Number(balance) / 10 ** USDC_DECIMALS;
      return Number.isFinite(balanceUsd) && balanceUsd >= requiredUsd;
    } catch (err) {
      // Any read failure (RPC unreachable, timeout, malformed response) is
      // treated identically to "not funded" -- never partially trust an
      // ambiguous on-chain read for a live-money decision.
      this.logger?.error(
        { error: err instanceof Error ? err.message : String(err), address },
        "funding-checker: on-chain USDC balance read failed, treating as unfunded (fail closed)",
      );
      return false;
    }
  }
}

/** Always-unfunded fail-closed checker -- used when this app has not been
 * given a real `FundingChecker` (mirrors the pattern `SystemHealthSnapshot`
 * uses elsewhere in this codebase for "no real implementation configured
 * yet" placeholders). Never used silently in place of real configuration --
 * `src/index.ts` always constructs `OnchainUsdcFundingChecker`, which
 * itself degrades to the same always-`false` behavior when unconfigured;
 * this class exists mainly so tests can express "funding checking is
 * simply unavailable" explicitly. */
export class AlwaysUnfundedFundingChecker implements FundingChecker {
  async isFunded(): Promise<boolean> {
    return false;
  }
}
