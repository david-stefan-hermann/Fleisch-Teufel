/**
 * Claude vision calls with structured output: the meal photo analysis and the food label reading.
 * The meal analysis runs as a tool loop: the model searches the food database itself
 * (`search_foods`, see `foodSearch.ts`) and answers with the ids it chose. Both use the beta
 * endpoint for server-side refusal fallbacks (`fallbacks: "default"`), so a false-positive safety
 * decline is retried on the recommended fallback model instead of failing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat, betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { aiItemSchema, type AiItem, type AiTypedValues } from '@ft/shared';
import { z } from 'zod';
import { LABEL_SYSTEM_PROMPT, labelSchema, labelUserPrompt, type LabelReading } from './label.js';
import { costUsd, knownModel } from './pricing.js';
import { SYSTEM_PROMPT, userPrompt } from './prompt.js';

export const analysisSchema = z.object({
  dishName: z.string().nullable(),
  items: z.array(aiItemSchema),
  notes: z.string().nullable(),
});

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export interface AnalyzeInput {
  /** One to `MAX_ANALYSIS_PHOTOS` photos of one meal (plates, courses, a label), in order. */
  images: { base64: string; mediaType: ImageMediaType }[];
  text: string | null;
  /** Calories and macros the person typed for the whole meal: a clue for the amounts. */
  typed?: AiTypedValues | null;
}

/** Tokens and cost of a Claude call (all rounds of a tool loop together). */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AnalyzeOutput {
  dishName: string | null;
  items: AiItem[];
  notes: string | null;
  model: string;
  usage: AiUsage;
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
  usage: AiUsage;
}

/** The model's food search: query in, hits as text out (`createFoodSearch`). */
export type SearchFoods = (query: string) => Promise<string>;

/** Requests of one meal analysis at most (searches plus the answer). */
export const MAX_ANALYSIS_ROUNDS = 8;

export interface FoodAnalyzer {
  /** `signal` ends the whole tool loop (all rounds) when the server's budget is used up. */
  analyze(input: AnalyzeInput, searchFoods: SearchFoods, signal?: AbortSignal): Promise<AnalyzeOutput>;
  /** Copies what 1 to 3 photos of a food label say (one call for all photos), within `signal`. */
  readLabel(input: LabelInput, signal?: AbortSignal): Promise<LabelOutput>;
}

export class AiRefusalError extends Error {
  constructor(public readonly category: string | null) {
    super('The model declined to analyze this image');
  }
}

export class AiOutputError extends Error {}

/**
 * A Claude call that failed after it may have cost money: `cause` is the actual error (an
 * `AiRefusalError`, `AiOutputError` or SDK error), `usage` what the rounds before it cost, so the
 * failure can be logged and counted towards the budget.
 */
export class AiCallError extends Error {
  constructor(
    cause: unknown,
    public readonly usage: AiUsage,
    public readonly model: string | null,
    public readonly rounds: number,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'AiCallError';
  }
}

const NO_USAGE: AiUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };

export function createClaudeAnalyzer(opts: {
  apiKey: string;
  model: string;
  /** Model for the label reading; the plate analysis always uses `model`. */
  labelModel?: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}): FoodAnalyzer {
  // Both calls run under the route's AbortSignal (`ANALYSIS_BUDGET_MS`), which also ends retries.
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 120_000, maxRetries: 2 });
  // Claude Haiku 4.5 takes neither adaptive thinking nor an effort level nor the refusal fallback;
  // Claude Haiku 5.5 takes thinking and effort, but has no server-side fallback.
  const paramsFor = (model: string) => {
    const id = knownModel(model) ?? model;
    if (id === 'claude-haiku-4-5') return { modelParams: {}, effort: {} };
    const thinking = { type: 'adaptive' as const };
    if (id === 'claude-haiku-5-5') return { modelParams: { thinking }, effort: { effort: opts.effort } };
    return {
      modelParams: {
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default' as const,
        thinking,
      },
      effort: { effort: opts.effort },
    };
  };
  const { modelParams, effort } = paramsFor(opts.model);
  const labelModel = opts.labelModel ?? opts.model;
  const label = paramsFor(labelModel);
  /**
   * Usage of a response. The token count includes cache writes and reads; the cost takes their
   * rates per model (`pricing.ts`), which matters in the tool loop where the photo is read from the
   * cache from the second round on.
   */
  const usageOf = (response: { model: string; usage: Anthropic.Beta.BetaUsage }): AiUsage => {
    const u = response.usage;
    const written = u.cache_creation_input_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    return {
      inputTokens: u.input_tokens + written + read,
      outputTokens: u.output_tokens,
      costUsd: costUsd(response.model, {
        inputTokens: u.input_tokens,
        cacheWriteTokens: written,
        cacheReadTokens: read,
        outputTokens: u.output_tokens,
      }),
    };
  };
  return {
    async analyze(input, searchFoods, signal) {
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
      const runner = client.beta.messages.toolRunner(
        {
          model: opts.model,
          max_tokens: 16000,
          max_iterations: MAX_ANALYSIS_ROUNDS,
          ...modelParams,
          output_config: { ...effort, format: betaZodOutputFormat(analysisSchema) },
          // The photos are sent again with every round; from the second one they are read from the cache.
          cache_control: { type: 'ephemeral' },
          system: SYSTEM_PROMPT,
          tools: [searchTool],
          messages: [
            {
              role: 'user',
              // Several photos get a label each, so the model can refer to them ("Foto 2").
              content: [
                ...input.images.flatMap((img, i) => [
                  ...(input.images.length > 1 ? [{ type: 'text' as const, text: `Foto ${i + 1}:` }] : []),
                  {
                    type: 'image' as const,
                    source: { type: 'base64' as const, media_type: img.mediaType, data: img.base64 },
                  },
                ]),
                { type: 'text', text: userPrompt(input.text, input.images.length, input.typed ?? null) },
              ],
            },
          ],
        },
        signal ? { signal } : undefined,
      );
      let response: Anthropic.Beta.BetaMessage | null = null;
      const usage: AiUsage = { ...NO_USAGE };
      let rounds = 0;
      // Every failure carries what the rounds so far cost (they are paid for either way).
      const failed = (e: unknown) => new AiCallError(e, usage, response?.model ?? null, rounds);
      try {
        for await (const message of runner) {
          response = message;
          rounds++;
          const u = usageOf(message);
          usage.inputTokens += u.inputTokens;
          usage.outputTokens += u.outputTokens;
          usage.costUsd += u.costUsd;
        }
      } catch (e) {
        throw failed(signal?.aborted ? new AiOutputError('timeout') : e);
      }
      if (!response) throw failed(new AiOutputError('no response'));
      if (response.stop_reason === 'refusal')
        throw failed(new AiRefusalError(response.stop_details?.category ?? null));
      const text = response.content.findLast((b) => b.type === 'text')?.text;
      if (response.stop_reason !== 'end_turn' || !text)
        throw failed(new AiOutputError(`no parsable output (stop_reason ${response.stop_reason})`));
      let parsed: z.infer<typeof analysisSchema>;
      try {
        parsed = analysisSchema.parse(JSON.parse(text));
      } catch {
        throw failed(new AiOutputError('output does not match the schema'));
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

    async readLabel(input, signal) {
      let response;
      try {
        response = await client.beta.messages.parse(
          {
            model: labelModel,
            max_tokens: 16000,
            ...label.modelParams,
            output_config: { ...label.effort, format: betaZodOutputFormat(labelSchema) },
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
          },
          signal ? { signal } : undefined,
        );
      } catch (e) {
        // A failed request is not billed; only the aborted one may have been (unknown, so 0).
        throw new AiCallError(signal?.aborted ? new AiOutputError('timeout') : e, NO_USAGE, null, 1);
      }
      const usage = usageOf(response);
      if (response.stop_reason === 'refusal')
        throw new AiCallError(
          new AiRefusalError(response.stop_details?.category ?? null),
          usage,
          response.model,
          1,
        );
      if (response.stop_reason === 'max_tokens' || !response.parsed_output)
        throw new AiCallError(
          new AiOutputError(`no parsable output (stop_reason ${response.stop_reason})`),
          usage,
          response.model,
          1,
        );
      return { reading: response.parsed_output, model: response.model, usage };
    },
  };
}
