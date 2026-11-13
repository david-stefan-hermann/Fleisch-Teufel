import { describe, expect, it } from 'vitest';
import {
  figureState,
  initialState,
  reduce,
  type Bubble,
  type MachineEvent,
  type MachineState,
} from '@/features/assistant/machine';
import { pickMime } from '@/features/assistant/recorder';

const run = (events: MachineEvent[], from: MachineState = initialState) => events.reduce(reduce, from);
const question: Bubble = {
  turnId: 1,
  kind: 'question',
  text: 'Welche Gurken?',
  options: ['Salat', 'Gewürz'],
};

describe('assistant button state machine', () => {
  it('tap records, a second tap sends, the result rests with the "done" face', () => {
    const s = run([{ type: 'startRecording' }, { type: 'recording' }, { type: 'send', typed: false }]);
    expect(s.phase).toBe('thinking');
    const done = reduce(s, { type: 'result', bubble: null, listen: false });
    expect(done).toMatchObject({ phase: 'idle', mood: 'done' });
    expect(figureState(done, false)).toBe('done');
  });

  it('a question after speech opens the microphone, not after typing', () => {
    const spoken = run([{ type: 'startRecording' }, { type: 'recording' }, { type: 'send', typed: false }]);
    expect(reduce(spoken, { type: 'result', bubble: question, listen: true }).phase).toBe('listening');
    const typed = run([
      { type: 'keyboard', transcribing: false },
      { type: 'send', typed: true },
    ]);
    expect(reduce(typed, { type: 'result', bubble: question, listen: true }).phase).toBe('asking');
  });

  it('the open microphone closes without an answer, but not while someone speaks', () => {
    const listening = run([
      { type: 'send', typed: false },
      { type: 'result', bubble: question, listen: true },
    ]);
    expect(reduce(listening, { type: 'listenEnd' }).phase).toBe('asking');
    const heard = reduce(listening, { type: 'heard' });
    expect(heard.hearing).toBe(true);
    expect(reduce(heard, { type: 'listenEnd' }).phase).toBe('listening');
  });

  it('keyboard during a recording waits for the text; discarding a recording shows the face', () => {
    const typing = run([
      { type: 'startRecording' },
      { type: 'recording' },
      { type: 'keyboard', transcribing: true },
    ]);
    expect(typing).toMatchObject({ phase: 'typing', text: null });
    expect(reduce(typing, { type: 'transcribed', text: 'Banane' }).text).toBe('Banane');
    const discarded = run([{ type: 'startRecording' }, { type: 'recording' }, { type: 'discard' }]);
    expect(discarded).toMatchObject({ phase: 'idle', mood: 'discarded' });
  });

  it('long press offers the keyboard only at rest or with a question', () => {
    expect(reduce(initialState, { type: 'longPress' }).keys).toBe(true);
    const thinking = reduce(initialState, { type: 'send', typed: true });
    expect(reduce(thinking, { type: 'longPress' }).keys).toBe(false);
  });

  it('sending an answer closes the question, so it cannot be answered twice', () => {
    const asking = reduce(initialState, { type: 'ask', bubble: question });
    expect(reduce(asking, { type: 'send', typed: true }).bubble).toBeNull();
  });

  it('a late question does not interrupt a recording', () => {
    const rec = run([{ type: 'startRecording' }, { type: 'recording' }]);
    expect(reduce(rec, { type: 'ask', bubble: question })).toBe(rec);
    expect(reduce(initialState, { type: 'ask', bubble: question }).phase).toBe('asking');
  });

  it('the last seconds of a recording show the warning face', () => {
    const rec = run([{ type: 'startRecording' }, { type: 'recording' }]);
    expect(figureState(rec, false)).toBe('listening');
    expect(figureState(rec, true)).toBe('warn');
  });

  it('records Opus in WebM where possible, MP4 on Safari', () => {
    expect(pickMime((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus');
    expect(pickMime((t) => t === 'audio/mp4')).toBe('audio/mp4');
    expect(pickMime(() => false)).toBeUndefined();
  });
});
