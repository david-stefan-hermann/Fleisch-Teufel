/**
 * Claude vision call with structured output. Uses the beta endpoint for server-side refusal
 * fallbacks (`fallbacks: "default"`), so a false-positive safety decline is retried on the
 * recommended fallback model instead of failing the analysis.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiItemSchema, type AiItem } from '@ft/shared';
import { z } from 'zod';
import { costUsd } from './pricing.js';
import { SYSTEM_PROMPT, userPrompt } from './prompt.js';

export const analysisSchema = z.object({
  dishName: z.string().nullable(),
  items: z.array(aiItemSchema),
  notes: z.string().nullable(),
});

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface AnalyzeInput {
  imageBase64: string;
  mediaType: ImageMediaType;
  text: string | null;
}

export interface AnalyzeOutput {
  dishName: string | null;
  items: AiItem[];
  notes: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface FoodAnalyzer {
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
}

export class AiRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super('The model declined to analyze this image');
  }
}

export class AiOutputError extends Error {}

export function createClaudeAnalyzer(opts: {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}): FoodAnalyzer {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 120_000, maxRetries: 2 });
  return {
    async analyze(input) {
      const response = await client.beta.messages.parse({
        model: opts.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: opts.effort, format: betaZodOutputFormat(analysisSchema) },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 },
              },
              { type: 'text', text: userPrompt(input.text) },
            ],
          },
        ],
      });
      if (response.stop_reason === 'refusal')
        throw new AiRefusalError(response.stop_details?.category ?? null);
      if (response.stop_reason === 'max_tokens' || !response.parsed_output)
        throw new AiOutputError(`no parsable output (stop_reason ${response.stop_reason})`);
      const u = response.usage;
      const inputTokens =
        u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      const usage = { inputTokens, outputTokens: u.output_tokens };
      return {
        dishName: response.parsed_output.dishName?.trim() || null,
        items: response.parsed_output.items,
        notes: response.parsed_output.notes,
        model: response.model,
        usage: { ...usage, costUsd: costUsd(response.model, usage) },
      };
    },
  };
}
