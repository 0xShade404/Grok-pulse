"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartPoint } from "@/lib/calc/chart";
import { computeDistanceFromStrike, computeMomentum } from "@/lib/calc/chart";
import { formatAssetPrice, formatSignedPct } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

/**
 * Underlying crypto price chart (CLAUDE.md section 30): BTC/ETH price,
 * strike line, distance to strike, short-term momentum.
 */
export function UnderlyingChart({
  asset,
  series,
  strike,
}: {
  asset: "BTC" | "ETH";
  series: ChartPoint[];
  strike: number | undefined;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const strikeLineRef = useRef<IPriceLine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart: IChartApi = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#99a6b8",
        fontFamily:
          "ui-monospace, SF Mono, Cascadia Code, JetBrains Mono, Menlo, Consolas, monospace",
      },
      grid: {
        vertLines: { color: "#212934" },
        horzLines: { color: "#212934" },
      },
      rightPriceScale: { borderColor: "#212934" },
      timeScale: { borderColor: "#212934", timeVisible: true, secondsVisible: true },
    });

    priceSeriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59, 130, 246, 0.25)",
      bottomColor: "rgba(59, 130, 246, 0.02)",
      lineWidth: 2,
      title: asset,
    });

    return () => {
      chart.remove();
      priceSeriesRef.current = null;
      strikeLineRef.current = null;
    };
  }, [asset]);

  useEffect(() => {
    if (series.length === 0 || !priceSeriesRef.current) return;
    priceSeriesRef.current.setData(
      series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );

    if (strikeLineRef.current) {
      priceSeriesRef.current.removePriceLine(strikeLineRef.current);
      strikeLineRef.current = null;
    }
    if (strike) {
      strikeLineRef.current = priceSeriesRef.current.createPriceLine({
        price: strike,
        color: "#f59e0b",
        lineWidth: 1,
        lineStyle: 3,
        axisLabelVisible: true,
        title: "Strike",
      });
    }
  }, [series, strike]);

  const momentum = computeMomentum(series);
  const distance = strike != null ? computeDistanceFromStrike(series, strike) : null;

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="h-full min-h-[140px] w-full flex-1" />
      <div className="flex items-center gap-4 border-t border-border px-1 pt-1 text-[11px]">
        {distance != null && (
          <span className="text-ink-faint">
            Distance to strike{" "}
            <span className={cn("num font-medium", distance >= 0 ? "text-buy" : "text-sell")}>
              {distance >= 0 ? "+" : ""}
              {formatAssetPrice(distance)}
            </span>
          </span>
        )}
        <span className="text-ink-faint">
          Momentum{" "}
          <span className={cn("num font-medium", momentum.pct >= 0 ? "text-buy" : "text-sell")}>
            {formatSignedPct(momentum.pct, 2)}
          </span>
        </span>
      </div>
    </div>
  );
}
