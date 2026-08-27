/** MOCK FIXTURE MODULE -- Phase 1. See lib/mock/markets.ts header comment. */
import type { CalibrationBucket } from "@/lib/types";
import { buildMockCalibration } from "@/lib/mock/performance";

export interface AgentStats {
  model: string;
  strategyVersion: string;
  signalCount: number;
  buyYesCount: number;
  buyNoCount: number;
  passCount: number;
  averageConfidence: number;
  averageEdge: number;
  agentLatencyMs: number;
  correctSignals: number;
  incorrectSignals: number;
  calibration: CalibrationBucket[];
}

export function buildMockAgentStats(): AgentStats {
  return {
    model: "grok-4",
    strategyVersion: "grokpulse-5m-v0.1.0",
    signalCount: 312,
    buyYesCount: 118,
    buyNoCount: 94,
    passCount: 100,
    averageConfidence: 0.69,
    averageEdge: 0.058,
    agentLatencyMs: 940,
    correctSignals: 123,
    incorrectSignals: 89,
    calibration: buildMockCalibration(),
  };
}
