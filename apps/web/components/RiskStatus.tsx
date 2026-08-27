import type { RiskDecision } from "@grokpulse/types";
import { CheckCircle2, XCircle } from "lucide-react";
import { StatusIndicator } from "@/components/StatusIndicator";
import { cn } from "@/lib/utils";

export interface RiskCheck {
  label: string;
  passed: boolean;
}

/**
 * Risk engine decision display (CLAUDE.md section 19-20). The risk engine
 * itself is deterministic backend logic -- this component only renders the
 * `RiskDecision` and a checklist it is handed, it never computes approval
 * itself (CLAUDE.md section 84 point 10).
 */
export function RiskStatus({
  decision,
  checks,
}: {
  decision: RiskDecision;
  checks?: RiskCheck[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <StatusIndicator
          state={decision.approved ? "LOW_RISK" : "HIGH_RISK"}
          label={decision.approved ? "RISK: APPROVED" : "RISK: REJECTED"}
        />
        {decision.code && <span className="text-[10px] text-ink-faint">{decision.code}</span>}
      </div>
      <p className="text-xs text-ink-dim">{decision.reason}</p>
      {checks && checks.length > 0 && (
        <ul className="flex flex-col gap-1">
          {checks.map((check) => (
            <li key={check.label} className="flex items-center gap-1.5 text-[11px]">
              {check.passed ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-ok" aria-hidden />
              ) : (
                <XCircle className="size-3.5 shrink-0 text-danger" aria-hidden />
              )}
              <span className={cn(check.passed ? "text-ink-dim" : "text-ink")}>{check.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
