/**
 * Microphone recording for the assistant. The microphone runs only while recording and during the
 * open window after a question; every stop releases it. `audio/webm;codecs=opus` where the browser
 * has it, else `audio/mp4` (Safari), at 32 kbit/s (two minutes are about half a megabyte). The level
 * comes from an `AnalyserNode`; one `AudioContext` for the app, made in the first tap (iOS allows it
 * only in a gesture) and resumed on every start.
 */
import { MAX_RECORD_MS } from '@ft/shared';
import { ANSWER_PAUSE_MS } from './machine';

export interface Recording {
  blob: Blob;
  durationMs: number;
}

export interface Recorder {
  readonly maxMs: number;
  /** Current sound level, 0..1. */
  level(): number;
  elapsed(): number;
  stop(): Promise<Recording>;
  cancel(): void;
}

let audioContext: AudioContext | null = null;

function context(): AudioContext | null {
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioContext ??= new Ctor();
  void audioContext.resume().catch(() => {});
  return audioContext;
}

/** The recording format: Opus in WebM where possible, MP4/AAC on Safari. */
export function pickMime(isSupported: (t: string) => boolean): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2'].find((t) =>
    isSupported(t),
  );
}

class NotSupported extends Error {
  override name = 'NotSupportedError';
}

/**
 * Starts recording. `onSpeech` fires when the level rises clearly above the room's noise, `onSilence`
 * once there was speech and then `ANSWER_PAUSE_MS` of quiet (the open microphone after a question).
 */
export async function startRecorder(
  opts: { onSpeech?: () => void; onSilence?: () => void } = {},
): Promise<Recorder> {
  // In the gesture, before anything is awaited.
  const ctx = context();
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new NotSupported();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });
  const mimeType = pickMime((t) => MediaRecorder.isTypeSupported(t));
  let media: MediaRecorder;
  try {
    media = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 32_000 });
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const chunks: Blob[] = [];
  media.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const started = Date.now();
  media.start(1000);

  // Level and speech detection.
  let level = 0;
  let source: MediaStreamAudioSourceNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  if (ctx) {
    source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let floor = 0.01;
    let spoke = false;
    let lastLoud = 0;
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      level = Math.min(1, rms * 8);
      const t = Date.now() - started;
      // The first 300 ms measure the room.
      if (t < 300) {
        floor = Math.max(floor, rms);
        return;
      }
      if (rms > Math.max(0.03, floor * 3)) {
        lastLoud = t;
        if (!spoke) {
          spoke = true;
          opts.onSpeech?.();
        }
      } else if (spoke && t - lastLoud > ANSWER_PAUSE_MS) {
        spoke = false;
        opts.onSilence?.();
      }
    }, 100);
  }

  const release = () => {
    if (timer) clearInterval(timer);
    source?.disconnect();
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    maxMs: MAX_RECORD_MS,
    level: () => level,
    elapsed: () => Date.now() - started,
    stop: () =>
      new Promise<Recording>((resolve) => {
        const done = () => {
          release();
          resolve({
            blob: new Blob(chunks, { type: (media.mimeType || mimeType || 'audio/webm').split(';')[0] }),
            durationMs: Date.now() - started,
          });
        };
        if (media.state === 'inactive') return done();
        media.onstop = done;
        media.stop();
      }),
    cancel: () => {
      media.onstop = null;
      if (media.state !== 'inactive') media.stop();
      release();
    },
  };
}
