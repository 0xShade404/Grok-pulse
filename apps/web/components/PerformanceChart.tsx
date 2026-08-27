"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  BaselineSeries,
  ColorType,
  createChart,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SeriesPoint } from "@/lib/types";

/** Minimal structural handle covering only what this component needs --
 * sidesteps having to union two distinct `ISeriesApi<T>` generic
 * instantiations, since both Area and Baseline series accept the same
 * `{ time, value }` point shape. */
interface SimpleSeriesHandle {
  setData(data: { time: UTCTimestamp; value: number }[]): void;
}

/**
 * Generic time-series performance chart (CLAUDE.md section 35): used for
 * cumulative P&L, drawdown, and win-rate-over-time panels on /performance.
 * Charts here render against `lib/mock-data.ts` series in Phase 1; the
 * shape (`SeriesPoint[]`) is exactly what a real `/api/performance`
 * response would provide, so swapping the data source later requires no
 * change to this component.
 */
export function PerformanceChart({
  series,
  mode = "area",
  color = "#3b82f6",
  format = "usd",
  height = 160,
}: {
  series: SeriesPoint[];
  /** "baseline" renders positive/negative regions in different colors --
   * appropriate for P&L and drawdown, which can cross zero. */
  mode?: "area" | "baseline";
  color?: string;
  format?: "usd" | "pct";
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const seriesRef = useRef<SimpleSeriesHandle | null>(null);

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
      grid: { vertLines: { color: "#212934" }, horzLines: { color: "#1a2029" } },
      rightPriceScale: { borderColor: "#212934" },
      timeScale: { borderColor: "#212934", timeVisible: false },
      handleScroll: false,
      handleScale: false,
    });

    const priceFormat =
      format === "usd"
        ? ({ type: "custom", formatter: (v: number) => `$${v.toFixed(0)}` } as const)
        : ({ type: "percent" } as const);

    seriesRef.current =
      mode === "baseline"
        ? chart.addSeries(BaselineSeries, {
            baseValue: { type: "price", price: 0 },
            topLineColor: "#22c55e",
            topFillColor1: "rgba(34, 197, 94, 0.24)",
            topFillColor2: "rgba(34, 197, 94, 0.02)",
            bottomLineColor: "#f43f5e",
            bottomFillColor1: "rgba(244, 63, 94, 0.02)",
            bottomFillColor2: "rgba(244, 63, 94, 0.24)",
            lineWidth: 2,
            priceFormat,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: color,
            topColor: `${color}33`,
            bottomColor: `${color}03`,
            lineWidth: 2,
            priceFormat,
          });

    return () => {
      chart.remove();
      seriesRef.current = null;
    };
  }, [mode, color, format]);

  useEffect(() => {
    if (series.length === 0 || !seriesRef.current) return;
    seriesRef.current.setData(
      series.map((p) => ({
        time: (new Date(p.timestamp).getTime() / 1000) as UTCTimestamp,
        value: format === "pct" ? p.value * 100 : p.value,
      })),
    );
  }, [series, format]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}
