import { log } from '../log.js';

/**
 * USD per million tokens (Anthropic first-party prices, checked 2026-11-12). `cacheRead` differs per
 * model (0.05 × input on Claude Opus 5.5, 0.025 × on Claude Fable 5.1, else 0.1 ×); cache writes
 * (5 minutes) cost 1.25 × input everywhere.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};

const CACHE_WRITE_FACTOR = 1.25;
const FALLBACK_MODEL = 'claude-opus-5-5';

const warned = new Set<string>();

/**
 * The price list entry of a model id. Responses may name a dated snapshot
 * ("claude-haiku-4-5-20251001"): only such a date suffix is dropped, so "claude-opus-5" never
 * stands in for "claude-opus-5-5".
 */
export function knownModel(model: string): string | null {
  const id = model.replace(/-\d{8}$/, '');
  return id in MODEL_PRICES ? id : null;
}

export function costUsd(
  model: string,
  usage: {
    /** Uncached input tokens. */
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  },
): number {
  const known = knownModel(model);
  if (!known && !warned.has(model)) {
    warned.add(model);
    log.warn('unknown model, costs use Opus prices', { model });
  }
  const p = MODEL_PRICES[known ?? FALLBACK_MODEL]!;
  return (
    (usage.inputTokens * p.input +
      (usage.cacheWriteTokens ?? 0) * p.input * CACHE_WRITE_FACTOR +
      (usage.cacheReadTokens ?? 0) * p.cacheRead +
      usage.outputTokens * p.output) /
    1_000_000
  );
}

/**
 * USD per audio minute of the transcription models (OpenAI, checked 2026-11-13 on
 * developers.openai.com/api/docs/pricing). They bill the duration, not tokens.
 */
export const TRANSCRIBE_PRICES: Record<string, number> = {
  'gpt-transcribe': 0.0045,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
};

/** Cost of transcribing `seconds` of audio; an unknown model counts at the dearest price. */
export function transcriptionCostUsd(model: string, seconds: number): number {
  const perMinute = TRANSCRIBE_PRICES[model] ?? Math.max(...Object.values(TRANSCRIBE_PRICES));
  return (Math.max(0, seconds) / 60) * perMinute;
}
