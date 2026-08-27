"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/StatusIndicator";
import { KillSwitch } from "@/components/KillSwitch";
import { AdminToggleControl } from "@/components/AdminToggleControl";
import { useAdminCounts, useRiskEvents, useSystemHealth } from "@/lib/api/admin";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { formatRelativeTime } from "@/lib/calc/format";

export default function AdminPage() {
  const { data: health = [] } = useSystemHealth();
  const { data: counts } = useAdminCounts();
  const { data: riskEvents = [] } = useRiskEvents();

  const strategyEnabled = useSettingsStore((s) => s.strategyEnabled);
  const setStrategyEnabled = useSettingsStore((s) => s.setStrategyEnabled);
  const liveTradingEnabled = useSettingsStore((s) => s.liveTradingEnabled);
  const assetsEnabled = useSettingsStore((s) => s.assetsEnabled);
  const setAssetEnabled = useSettingsStore((s) => s.setAssetEnabled);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>System Health</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {health.map((tile) => (
            <div key={tile.key} className="flex flex-col gap-1 rounded border border-border bg-panel-2 p-2.5">
              <span className="text-[11px] font-medium text-ink-dim">{tile.label}</span>
              <StatusIndicator state={tile.status === "HEALTHY" ? "HEALTHY" : tile.status === "DEGRADED" ? "DEGRADED" : "DOWN"} />
              <span className="text-[10px] text-ink-faint">{tile.detail}</span>
              {tile.latencyMs != null && (
                <span className="num text-[10px] text-ink-faint">{tile.latencyMs}ms</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Counts</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <CountRow label="Active markets" value={counts?.activeMarkets} />
            <CountRow label="Active positions" value={counts?.activePositions} />
            <CountRow label="Open orders" value={counts?.openOrders} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Global Kill Switch</CardTitle>
          </CardHeader>
          <CardContent>
            <KillSwitch />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Admin Controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <AdminToggleControl
              label="Strategy"
              enabled={strategyEnabled}
              onConfirm={setStrategyEnabled}
              confirmDisableCopy="New signals will stop being acted on for every market. Existing paper positions are unaffected."
              confirmEnableCopy="Resumes signal generation and order eligibility."
            />
            <AdminToggleControl
              label="BTC asset"
              enabled={assetsEnabled.BTC}
              onConfirm={(next) => setAssetEnabled("BTC", next)}
              confirmDisableCopy="No new BTC 5-minute markets will be traded."
              confirmEnableCopy="Resumes trading eligibility for BTC 5-minute markets."
            />
            <AdminToggleControl
              label="ETH asset"
              enabled={assetsEnabled.ETH}
              onConfirm={(next) => setAssetEnabled("ETH", next)}
              confirmDisableCopy="No new ETH 5-minute markets will be traded."
              confirmEnableCopy="Resumes trading eligibility for ETH 5-minute markets."
            />
            <AdminToggleControl
              label="Live trading"
              enabled={liveTradingEnabled}
              onConfirm={() => {
                /* Intentionally a no-op: live trading cannot be enabled from
                 * this Phase 1 build -- see CLAUDE.md section 22, 90-91.
                 * There is no wallet, signer, or execution backend to
                 * authorize against, so the control stays permanently off. */
              }}
              confirmDisableCopy="Live trading is already disabled."
              confirmEnableCopy="Live trading requires wallet connection, verification, and a live execution backend that does not exist in this Phase 1 build. This control cannot actually enable it."
            />
            <p className="text-[10px] text-ink-faint">(mock -- not yet connected to backend)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Risk Events</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {riskEvents.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    <Badge variant={event.eventType.includes("REJECTED") ? "danger" : event.eventType.includes("APPROVED") || event.eventType.includes("FILLED") ? "ok" : "default"}>
                      {event.eventType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-ink-faint">{event.marketId ?? "--"}</TableCell>
                  <TableCell className="text-ink-dim">{event.reason}</TableCell>
                  <TableCell className="num text-right text-ink-faint">
                    {formatRelativeTime(event.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
              {riskEvents.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-ink-faint">
                    No risk events.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CountRow({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-ink-faint">{label}</span>
      <span className="num font-semibold text-ink">{value ?? "--"}</span>
    </div>
  );
}
