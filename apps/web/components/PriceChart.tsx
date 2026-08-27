"use client";

import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartPoint } from "@/lib/calc/chart";

/**
 * Prediction-market chart (CLAUDE.md section 30): YES probability and NO
 * probability (its complement), built on Lightweight Charts.
 */
export function PriceChart({ series }: { series: ChartPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const yesSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const noSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

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
      rightPriceScale: {
        borderColor: "#212934",
        scaleMargins: { top: 0.15, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#212934",
        timeVisible: true,
        secondsVisible: true,
      },
    });

    yesSeriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: "#22c55e",
      topColor: "rgba(34, 197, 94, 0.28)",
      bottomColor: "rgba(34, 197, 94, 0.02)",
      lineWidth: 2,
      priceFormat: { type: "percent" },
      title: "YES",
    });
    noSeriesRef.current = chart.addSeries(LineSeries, {
      color: "#f43f5e",
      lineWidth: 1,
      lineStyle: 2,
      priceFormat: { type: "percent" },
      title: "NO",
    });

    return () => {
      chart.remove();
      yesSeriesRef.current = null;
      noSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (series.length === 0) return;
    const yesData = series.map((p) => ({
      time: p.time as UTCTimestamp,
      value: p.value * 100,
    }));
    const noData = series.map((p) => ({
      time: p.time as UTCTimestamp,
      value: (1 - p.value) * 100,
    }));
    yesSeriesRef.current?.setData(yesData);
    noSeriesRef.current?.setData(noData);
  }, [series]);

  return <div ref={containerRef} className="h-full min-h-[180px] w-full" />;
}
