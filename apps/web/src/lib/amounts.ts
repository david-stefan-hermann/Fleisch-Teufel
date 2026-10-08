/** Upper end of an ingredient's gram slider: 2.5 × the reference amount, at least 50 g. */
export function rowSliderMax(base: number | null, grams: number | null): number {
  const roundUp10 = (g: number) => Math.ceil(g / 10) * 10;
  return Math.max(50, roundUp10((base ?? 100) * 2.5), roundUp10(grams ?? 0));
}
