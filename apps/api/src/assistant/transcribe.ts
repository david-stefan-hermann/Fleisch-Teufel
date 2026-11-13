/**
 * Speech to text with OpenAI's transcription endpoint (Claude takes no audio). A plain `fetch`: one
 * multipart request, German, the duration it bills comes back in `usage`.
 */
import { UpstreamError } from '../ai/admit.js';
import { transcriptionCostUsd } from '../ai/pricing.js';
import type { AudioInput, TranscribeOutput } from './types.js';

const URL = 'https://api.openai.com/v1/audio/transcriptions';

/** Audio formats the device sends (and the endpoint takes), told apart by their first bytes. */
export function sniffAudio(buf: Uint8Array): { mime: string; ext: string } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length < 12) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3)
    return { mime: 'audio/webm', ext: 'webm' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0))
    return { mime: 'audio/mpeg', ext: 'mp3' };
  return null;
}

function failure(status: number, body: string): UpstreamError {
  if (status === 401 || status === 403)
    return new UpstreamError({ status: 503, code: 'ai_misconfigured' }, `transcription ${status}`);
  if (status === 429) return new UpstreamError({ status: 503, code: 'upstream_rate_limited' }, body);
  if (status === 400) return new UpstreamError({ status: 422, code: 'bad_audio' }, body.slice(0, 300));
  return new UpstreamError({ status: 502, code: 'upstream_error' }, `transcription ${status}`);
}

export async function transcribeOpenAi(
  opts: { apiKey: string; model: string },
  audio: AudioInput,
  signal?: AbortSignal,
): Promise<TranscribeOutput> {
  const kind = sniffAudio(audio.bytes) ?? { mime: audio.mime, ext: 'webm' };
  const form = new FormData();
  form.set('model', opts.model);
  form.set('language', 'de');
  form.set('response_format', 'json');
  form.set(
    'file',
    new File([audio.bytes as Uint8Array<ArrayBuffer>], `utterance.${kind.ext}`, { type: kind.mime }),
  );
  let res: Response;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: signal ?? AbortSignal.timeout(60_000),
    });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === 'TimeoutError'))
      throw new UpstreamError({ status: 504, code: 'ai_timeout' }, 'transcription timeout');
    throw new UpstreamError({ status: 502, code: 'upstream_error' }, String(e));
  }
  const text = await res.text();
  if (!res.ok) throw failure(res.status, text);
  let body: { text?: unknown; usage?: { type?: string; seconds?: number } };
  try {
    body = JSON.parse(text);
  } catch {
    throw new UpstreamError({ status: 502, code: 'upstream_error' }, 'transcription: no JSON');
  }
  // Without a duration in the answer: the length the device's bitrate (32 kbit/s) gives.
  const seconds =
    (body.usage?.type === 'duration' && Number(body.usage.seconds)) || (audio.bytes.length * 8) / 32_000;
  return {
    text: typeof body.text === 'string' ? body.text.trim() : '',
    model: opts.model,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: transcriptionCostUsd(opts.model, seconds) },
  };
}
