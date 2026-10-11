/**
 * Claude vision calls with structured output: the meal photo analysis and the food label reading.
 * The meal analysis runs as a tool loop: the model searches the food database itself
 * (`search_foods`, see `foodSearch.ts`) and answers with the ids it chose. Both use the beta
 * endpoint for server-side refusal fallbacks (`fallbacks: "default"`), so a false-positive safety
 * decline is retried on the recommended fallback model instead of failing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
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
  /** Requests the analysis took (searches plus the answer). */
  rounds?: number;
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

/** The model's food search: query in, hits as text out (`createFoodSearch`). */
export type SearchFoods = (query: string) => Promise<string>;

/** Requests of one meal analysis at most (searches plus the answer). */
export const MAX_ANALYSIS_ROUNDS = 8;

export interface FoodAnalyzer {
  analyze(input: AnalyzeInput, searchFoods: SearchFoods): Promise<AnalyzeOutput>;
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
  // Claude Haiku 4.5 takes neither adaptive thinking nor an effort level nor the refusal fallback.
  const haiku = opts.model.startsWith('claude-haiku');
  const modelParams = haiku
    ? {}
    : {
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default' as const,
        thinking: { type: 'adaptive' as const },
      };
  const effort = haiku ? {} : { effort: opts.effort };
  /**
   * Usage of a response. The token count includes cache writes and reads; the cost takes their
   * rates (writes 1.25 ×, reads 0.1 × the input price), which matters in the tool loop where the
   * photo is read from the cache from the second round on.
   */
  const usageOf = (response: { model: string; usage: Anthropic.Beta.BetaUsage }) => {
    const u = response.usage;
    const written = u.cache_creation_input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    return {
      inputTokens: u.input_tokens + written + read,
      outputTokens: u.output_tokens,
      costUsd: costUsd(response.model, {
        inputTokens: u.input_tokens + written * 1.25 + read * 0.1,
        outputTokens: u.output_tokens,
      }),
    };
  };
  return {
    async analyze(input, searchFoods) {
      const searchTool = betaZodTool({
        name: 'search_foods',
        description:
          'Sucht Lebensmittel in der Datenbank der App (BLS, Open Food Facts, eigene Lebensmittel der Person). Liefert je Treffer eine Zeile mit id, Name, Quelle, kcal und Makros pro 100 g sowie Markierungen wie "früher gewählt". Rufe das Tool für jede Zutat auf, mehrere Zutaten parallel; bei schlechten Treffern noch einmal mit anderem Begriff.',
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              'Deutscher Suchbegriff, 1 bis 4 Wörter, z. B. "Hähnchen Brust gebraten" oder "Takoyaki"',
            ),
        }),
        run: (args) => searchFoods(args.query),
      });
      const runner = client.beta.messages.toolRunner({
        model: opts.model,
        max_tokens: 16000,
        max_iterations: MAX_ANALYSIS_ROUNDS,
        ...modelParams,
        output_config: { ...effort, format: betaZodOutputFormat(analysisSchema) },
        // The photo is sent again with every round; from the second one it is read from the cache.
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: [searchTool],
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
      let response: Anthropic.Beta.BetaMessage | null = null;
      const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      let rounds = 0;
      for await (const message of runner) {
        response = message;
        rounds++;
        const u = usageOf(message);
        usage.inputTokens += u.inputTokens;
        usage.outputTokens += u.outputTokens;
        usage.costUsd += u.costUsd;
      }
      if (!response) throw new AiOutputError('no response');
      if (response.stop_reason === 'refusal')
        throw new AiRefusalError(response.stop_details?.category ?? null);
      const text = response.content.findLast((b) => b.type === 'text')?.text;
      if (response.stop_reason !== 'end_turn' || !text)
        throw new AiOutputError(`no parsable output (stop_reason ${response.stop_reason})`);
      let parsed: z.infer<typeof analysisSchema>;
      try {
        parsed = analysisSchema.parse(JSON.parse(text));
      } catch {
        throw new AiOutputError('output does not match the schema');
      }
      return {
        dishName: parsed.dishName?.trim() || null,
        items: parsed.items,
        notes: parsed.notes,
        model: response.model,
        usage,
        rounds,
      };
    },

    async readLabel(input) {
      const response = await client.beta.messages.parse({
        model: opts.model,
        max_tokens: 16000,
        ...modelParams,
        output_config: { ...effort, format: betaZodOutputFormat(labelSchema) },
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
