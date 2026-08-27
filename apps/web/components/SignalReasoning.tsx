import type { AgentSignal } from "@grokpulse/types";
import { labelReasonCode } from "@/lib/mock-data";
import { Badge } from "@/components/ui/badge";

/** "SIGNAL EXPLANATION" panel (CLAUDE.md section 5, 75): reason codes plus
 * the agent's free-text reasoning. This is the agent's stated analysis,
 * not a promise -- never rendered as certainty. */
export function SignalReasoning({ signal }: { signal: AgentSignal }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {signal.reasonCodes.map((code) => (
          <Badge key={code} variant="outline">
            {labelReasonCode(code)}
          </Badge>
        ))}
        {signal.reasonCodes.length === 0 && (
          <span className="text-xs text-ink-faint">No reason codes reported.</span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-ink-dim">{signal.reasoning}</p>
    </div>
  );
}
