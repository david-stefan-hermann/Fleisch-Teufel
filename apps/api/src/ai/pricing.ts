/** USD per million tokens (Anthropic first-party prices, checked 2026-10-07). */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function costUsd(model: string, usage: { inputTokens: number; outputTokens: number }): number {
  const p = MODEL_PRICES[model] ?? MODEL_PRICES['claude-opus-5-5']!;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}
