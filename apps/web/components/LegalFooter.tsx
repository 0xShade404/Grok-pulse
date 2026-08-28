/**
 * Persistent legal/risk disclaimer (CLAUDE.md section 76). Rendered in the
 * root layout so it is present on every route. Never use "guaranteed",
 * "certain", or "risk-free" language anywhere in this app's copy.
 */
export function LegalFooter() {
  return (
    <footer className="border-t border-border bg-bg-elevated px-4 py-2 text-[11px] leading-relaxed text-ink-faint">
      <p>
        Trading prediction markets involves financial risk. AI-generated
        signals are estimates, not guarantees. Past performance does not
        guarantee future results. GrokPulse is currently in a read-only,
        Phase 1 build: all market, signal, and portfolio data on this page is
        fabricated mock data for interface development -- no live trading is
        possible.
      </p>
    </footer>
  );
}
