/** Pure chart-adjacent presentation math -- kept out of components. */
export interface ChartPoint {
  time: number;
  value: number;
}

/** Simple absolute + percentage change from the first to the last point in
 * a series, used for a "short-term momentum" readout under a chart. */
export function computeMomentum(series: ChartPoint[]): {
  absolute: number;
  pct: number;
} {
  if (series.length < 2) return { absolute: 0, pct: 0 };
  const first = series[0]!.value;
  const last = series[series.length - 1]!.value;
  const absolute = last - first;
  const pct = first !== 0 ? absolute / first : 0;
  return { absolute, pct };
}

/** Distance from the last value in a series to a strike price. */
export function computeDistanceFromStrike(series: ChartPoint[], strike: number): number {
  if (series.length === 0) return 0;
  return series[series.length - 1]!.value - strike;
}
