/**
 * The real assistant: OpenAI transcription plus a Claude tool loop (Haiku 5.5, effort low by default).
 * The loop is written by hand because the write tools are not executed here: every call goes to the
 * route's `ToolHost`, which answers with data (read tools) or a short receipt (write tools), and `ask`
 * ends the turn.
 */
import Anthropic from '@anthropic-ai/sdk';
import { AiCallError, AiOutputError, AiRefusalError, type AiUsage } from '../ai/analyze.js';
import { costUsd, knownModel } from '../ai/pricing.js';
import { ASSISTANT_SYSTEM } from './prompt.js';
import { assistantTools } from './tools.js';
import { transcribeOpenAi } from './transcribe.js';
import type { Assistant } from './types.js';

/** Requests of one utterance at most (searches, writes and the closing sentence). */
export const MAX_ASSISTANT_ROUNDS = 8;

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export function createAssistant(opts: {
  anthropicKey: string;
  model: string;
  effort: Effort;
  openaiKey?: string;
  transcribeModel: string;
}): Assistant {
  const client = new Anthropic({ apiKey: opts.anthropicKey, timeout: 60_000, maxRetries: 2 });
  // Claude Haiku 4.5 takes neither adaptive thinking nor an effort level; current models take both.
  const id = knownModel(opts.model) ?? opts.model;
  const modelParams =
    id === 'claude-haiku-4-5'
      ? {}
      : { thinking: { type: 'adaptive' as const }, output_config: { effort: opts.effort } };

  return {
    canTranscribe: !!opts.openaiKey,

    transcribe(audio, signal) {
      if (!opts.openaiKey) throw new Error('no transcription key');
      return transcribeOpenAi({ apiKey: opts.openaiKey, model: opts.transcribeModel }, audio, signal);
    },

    async understand(input, host, signal) {
      const tools = assistantTools(input.mealNames);
      const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: input.prompt }];
      const usage: AiUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      let model: string | null = null;
      let rounds = 0;
      let reply: string | null = null;
      const failed = (e: unknown) =>
        new AiCallError(signal?.aborted ? new AiOutputError('timeout') : e, usage, model, rounds);

      while (rounds < MAX_ASSISTANT_ROUNDS) {
        let response: Anthropic.Beta.BetaMessage;
        try {
          response = await client.beta.messages.create(
            {
              model: opts.model,
              max_tokens: 4000,
              ...modelParams,
              // The system prompt and the tools are the same for every utterance of this person; the
              // automatic breakpoint caches the growing conversation between the rounds.
              cache_control: { type: 'ephemeral' },
              system: [{ type: 'text', text: ASSISTANT_SYSTEM, cache_control: { type: 'ephemeral' } }],
              tools,
              messages,
            },
            signal ? { signal } : undefined,
          );
        } catch (e) {
          throw failed(e);
        }
        rounds++;
        model = response.model;
        const u = response.usage;
        const written = u.cache_creation_input_tokens ?? 0;
        const read = u.cache_read_input_tokens ?? 0;
        usage.inputTokens += u.input_tokens + written + read;
        usage.outputTokens += u.output_tokens;
        usage.costUsd += costUsd(response.model, {
          inputTokens: u.input_tokens,
          cacheWriteTokens: written,
          cacheReadTokens: read,
          outputTokens: u.output_tokens,
        });
        if (response.stop_reason === 'refusal')
          throw failed(new AiRefusalError(response.stop_details?.category ?? null));
        const text = response.content
          .flatMap((b) => (b.type === 'text' ? [b.text] : []))
          .join(' ')
          .trim();
        if (text) reply = text;
        const uses = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || uses.length === 0) {
          if (response.stop_reason === 'max_tokens') throw failed(new AiOutputError('max_tokens'));
          return { reply, model: response.model, usage, rounds };
        }
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        let stop = false;
        // One after the other: write calls are collected in the order the model made them.
        for (const use of uses) {
          let out: { result: string; stop?: boolean };
          try {
            out = await host.call(use.name, use.input);
          } catch (e) {
            throw failed(e);
          }
          results.push({ type: 'tool_result', tool_use_id: use.id, content: out.result });
          stop ||= !!out.stop;
        }
        // After `ask` the turn ends: nothing more is said or done until the answer comes.
        if (stop) return { reply: null, model: response.model, usage, rounds };
        messages.push({ role: 'user', content: results });
      }
      // Out of rounds: what was collected so far still counts (the device shows it with undo).
      return { reply, model: model ?? opts.model, usage, rounds };
    },
  };
}
