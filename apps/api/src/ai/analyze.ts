/**
 * Claude vision calls with structured output: the meal photo analysis and the food label reading.
 * Both use the beta endpoint for server-side refusal fallbacks (`fallbacks: "default"`), so a
 * false-positive safety decline is retried on the recommended fallback model instead of failing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiItemSchema, type AiItem } from '@ft/shared';
import { z } from 'zod';
import { LABEL_SYSTEM_PROMPT, labelSchema, labelUserPrompt, type LabelReading } from './label.js';
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

export interface LabelInput {
  images: { base64: string; mediaType: ImageMediaType }[];
  text: string | null;
}

export interface LabelOutput {
  reading: LabelReading;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface FoodAnalyzer {
  analyze(input: AnalyzeInput): Promise<AnalyzeOutput>;
  /** Copies what 1 to 3 photos of a food label say (one call for all photos). */
  readLabel(input: LabelInput): Promise<LabelOutput>;
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
  /** Usage of a response, cache tokens counted as input (they are billed as such, at their rates). */
  const usageOf = (response: { model: string; usage: Anthropic.Beta.BetaUsage }) => {
    const u = response.usage;
    const inputTokens =
      u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const usage = { inputTokens, outputTokens: u.output_tokens };
    return { ...usage, costUsd: costUsd(response.model, usage) };
  };
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
      return {
        dishName: response.parsed_output.dishName?.trim() || null,
        items: response.parsed_output.items,
        notes: response.parsed_output.notes,
        model: response.model,
        usage: usageOf(response),
      };
    },

    async readLabel(input) {
      const response = await client.beta.messages.parse({
        model: opts.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: opts.effort, format: betaZodOutputFormat(labelSchema) },
        system: LABEL_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              ...input.images.map((img) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
              })),
              { type: 'text', text: labelUserPrompt(input.text, input.images.length) },
            ],
          },
        ],
      });
      if (response.stop_reason === 'refusal')
        throw new AiRefusalError(response.stop_details?.category ?? null);
      if (response.stop_reason === 'max_tokens' || !response.parsed_output)
        throw new AiOutputError(`no parsable output (stop_reason ${response.stop_reason})`);
      return { reading: response.parsed_output, model: response.model, usage: usageOf(response) };
    },
  };
}
