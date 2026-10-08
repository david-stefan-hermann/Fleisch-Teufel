/** ISO date → uPlot x (seconds, local noon to avoid DST edge cases). */
export function xOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).getTime() / 1000;
}
