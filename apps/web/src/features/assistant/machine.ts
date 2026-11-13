/**
 * The assistant button as a pure state machine (tested on its own). The controller feeds it the
 * person's input and what the recorder and the queue report, and carries out the side effects the
 * new state asks for. Times come from mockup v6.
 */
export type Phase =
  'idle' | 'starting' | 'recording' | 'thinking' | 'asking' | 'listening' | 'typing' | 'confused';

/** Faces a figure shows for a moment while the button rests. */
export type Mood = 'done' | 'undone' | 'discarded' | 'carried' | 'error' | { idle: string };

/** How long the microphone stays open by itself after a question when nobody speaks. */
export const LISTEN_MS = 3000;
/** A figure does nothing by itself until the button has rested this long. */
export const REST_MS = 6000;
/** Rest faces come every 10 to 20 s in the app (more often in the mockup). */
export const IDLE_FACE_MIN_MS = 10_000;
export const IDLE_FACE_MAX_MS = 20_000;
/** A press this long opens the keyboard without recording. */
export const LONG_PRESS_MS = 450;
/** A pointer that moves farther than this carries the button. */
export const DRAG_PX = 8;
/** "Eingetragen" face after a result. */
export const DONE_MS = 2300;
/** "Nicht verstanden" face. */
export const CONFUSED_MS = 2200;
/** After speech in the listening window: this much quiet ends the answer. */
export const ANSWER_PAUSE_MS = 1100;

/** A question in the bubble: the server's (with the turn it belongs to), or the device's own. */
export interface Bubble {
  /** The turn that asked; null for the device's own question ("Fotos jetzt aufnehmen?") or a reply. */
  turnId: number | null;
  text: string;
  options: string[];
  kind: 'question' | 'camera' | 'reply';
}

export interface MachineState {
  phase: Phase;
  /** Keyboard (and X) offered next to the button after a long press. */
  keys: boolean;
  /** Text mode: the sentence; null while the recording is being transcribed. */
  text: string | null;
  bubble: Bubble | null;
  /** Speech was heard in the listening window. */
  hearing: boolean;
  /** Typed (or edited) input: a question after it never opens the microphone. */
  typed: boolean;
  mood: Mood | null;
}

export const initialState: MachineState = {
  phase: 'idle',
  keys: false,
  text: null,
  bubble: null,
  hearing: false,
  typed: false,
  mood: null,
};

export type MachineEvent =
  | { type: 'longPress' }
  | { type: 'hideKeys' }
  /** Tap on the button while resting or asking: a recording starts. */
  | { type: 'startRecording' }
  | { type: 'recording' }
  | { type: 'recordFailed' }
  /** Keyboard: from rest, from a question, or from a running recording (then `transcribing`). */
  | { type: 'keyboard'; transcribing: boolean }
  | { type: 'transcribed'; text: string }
  | { type: 'textChange'; text: string }
  /** The utterance is on its way (recording stopped, text sent, option tapped). */
  | { type: 'send'; typed: boolean }
  /** Recording or text thrown away. */
  | { type: 'discard' }
  /** Waiting for a connection: back to rest, the badge counts it. */
  | { type: 'queued' }
  | { type: 'result'; bubble: Bubble | null; listen: boolean }
  | { type: 'notUnderstood' }
  | { type: 'confusedEnd' }
  | { type: 'failed' }
  | { type: 'heard' }
  | { type: 'listenEnd' }
  /** A question that arrived while the person was not waiting (late answer, camera question). */
  | { type: 'ask'; bubble: Bubble }
  | { type: 'closeBubble' }
  | { type: 'mood'; mood: Mood | null };

export function reduce(s: MachineState, e: MachineEvent): MachineState {
  switch (e.type) {
    case 'longPress':
      return ['idle', 'asking', 'listening'].includes(s.phase) ? { ...s, keys: true } : s;
    case 'hideKeys':
      return { ...s, keys: false };
    case 'startRecording':
      if (s.phase !== 'idle' && s.phase !== 'asking' && s.phase !== 'listening') return s;
      return { ...s, phase: 'starting', keys: false, hearing: false, typed: false, mood: null };
    case 'recording':
      return s.phase === 'starting' ? { ...s, phase: 'recording' } : s;
    case 'recordFailed':
      return { ...s, phase: s.bubble ? 'asking' : 'idle', hearing: false };
    case 'keyboard':
      return {
        ...s,
        phase: 'typing',
        keys: false,
        text: e.transcribing ? null : '',
        hearing: false,
        mood: null,
      };
    case 'transcribed':
      return s.phase === 'typing' ? { ...s, text: e.text } : s;
    case 'textChange':
      return s.phase === 'typing' ? { ...s, text: e.text } : s;
    case 'send':
      return { ...s, phase: 'thinking', keys: false, text: null, hearing: false, typed: e.typed };
    case 'discard': {
      const mood = s.phase === 'recording' ? ('discarded' as const) : s.mood;
      return { ...s, phase: s.bubble ? 'asking' : 'idle', text: null, keys: false, hearing: false, mood };
    }
    case 'queued':
      return { ...s, phase: s.bubble ? 'asking' : 'idle' };
    case 'result':
      if (e.bubble)
        return {
          ...s,
          phase: e.listen && !s.typed && e.bubble.kind === 'question' ? 'listening' : 'asking',
          bubble: e.bubble,
          hearing: false,
          mood: null,
        };
      return { ...s, phase: 'idle', bubble: null, hearing: false, mood: 'done' };
    case 'notUnderstood':
      return { ...s, phase: 'confused', bubble: null, hearing: false, mood: null };
    case 'confusedEnd':
      return s.phase === 'confused' ? { ...s, phase: 'idle' } : s;
    case 'failed':
      return { ...s, phase: s.bubble ? 'asking' : 'idle', hearing: false, mood: 'error' };
    case 'heard':
      return s.phase === 'listening' ? { ...s, hearing: true } : s;
    case 'listenEnd':
      return s.phase === 'listening' && !s.hearing ? { ...s, phase: 'asking' } : s;
    case 'ask':
      return s.phase === 'idle' || s.phase === 'asking' ? { ...s, phase: 'asking', bubble: e.bubble } : s;
    case 'closeBubble':
      return {
        ...s,
        bubble: null,
        hearing: false,
        phase: s.phase === 'asking' || s.phase === 'listening' ? 'idle' : s.phase,
      };
    case 'mood':
      return { ...s, mood: e.mood };
  }
}

/** The picture key of a figure for this moment (`warn` in the last seconds of a recording). */
export function figureState(s: MachineState, warn: boolean): string {
  if (s.phase === 'recording' || s.phase === 'starting') return warn ? 'warn' : 'listening';
  if (s.phase === 'listening') return 'listening';
  if (s.phase === 'idle' && s.mood) return typeof s.mood === 'string' ? s.mood : s.mood.idle;
  return s.phase;
}
