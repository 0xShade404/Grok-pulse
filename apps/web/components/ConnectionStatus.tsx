"use client";

import { useEffect, useState } from "react";
import { wsClient } from "@/lib/ws/client";
import { StatusIndicator, type TerminalState } from "@/components/StatusIndicator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Reflects the real (currently stub) WebSocket connection state
 * (CLAUDE.md section 28). Phase 1 has no backend to connect to, so this
 * honestly reports DISCONNECTED rather than pretending live data is
 * flowing -- see lib/ws/client.ts.
 */
export function ConnectionStatus() {
  const [state, setState] = useState(wsClient.state);

  useEffect(() => {
    wsClient.connect();
    setState(wsClient.state);
  }, []);

  const terminalState: TerminalState =
    state === "CONNECTED" ? "CONNECTED" : state === "DEGRADED" ? "DEGRADED" : "DISCONNECTED";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <StatusIndicator state={terminalState} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {state === "DISCONNECTED"
          ? "No live market-data backend is connected yet (Phase 1: read-only UI shell against mock fixtures)."
          : "Live market-data WebSocket connection."}
      </TooltipContent>
    </Tooltip>
  );
}
