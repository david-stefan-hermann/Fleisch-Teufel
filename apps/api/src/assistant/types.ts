/**
 * The assistant's two paid steps behind one interface (like `FoodAnalyzer`): the transcription of a
 * recording and the tool loop that turns a sentence into operations. Tests pass a fake.
 */
import type { AiUsage } from '../ai/analyze.js';

export interface AudioInput {
  bytes: Uint8Array;
  mime: string;
}

export interface TranscribeOutput {
  text: string;
  model: string;
  usage: AiUsage;
}

/**
 * Runs the model's tool calls. Read tools answer with data; write tools are checked and collected by
 * the route (never executed on the server) and answered with a short result. `stop` ends the turn
 * (`ask`).
 */
export interface ToolHost {
  call(name: string, input: unknown): Promise<{ result: string; stop?: boolean }>;
}

export interface UnderstandOutput {
  /** The model's closing sentence; null after `ask` or when it wrote none. */
  reply: string | null;
  model: string;
  usage: AiUsage;
  rounds: number;
}

export interface Assistant {
  /** False without a transcription key: then only typed sentences. */
  readonly canTranscribe: boolean;
  transcribe(audio: AudioInput, signal?: AbortSignal): Promise<TranscribeOutput>;
  /** `prompt` is the context and the sentence; `mealNames` fill the meal enums of the tools. */
  understand(
    input: { prompt: string; mealNames: readonly string[] },
    host: ToolHost,
    signal?: AbortSignal,
  ): Promise<UnderstandOutput>;
}
