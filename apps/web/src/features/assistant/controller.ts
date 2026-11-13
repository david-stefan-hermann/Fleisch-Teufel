/**
 * The assistant button's behaviour: the state machine (`machine.ts`) plus everything it sets off,
 * recording, text mode, sending, the result as toast or bubble, the camera. One instance per
 * signed-in session; React reads it with `useSyncExternalStore`.
 */
import { MAX_RECORD_MS, today as todayOf, uuidv7, type ISODate } from '@ft/shared';
import { toast } from 'sonner';
import type { UserDb } from '@/db/dexie';
import { errorMessage } from '@/lib/api';
import { summaryText, targetFor, type CameraOp } from './execute';
import { storeAssistantHint } from './hint';
import {
  CONFUSED_MS,
  DONE_MS,
  initialState,
  LISTEN_MS,
  reduce,
  type Bubble,
  type MachineEvent,
  type MachineState,
  type Mood,
} from './machine';
import {
  closeQuestion,
  enqueueTurn,
  onAssistantTurn,
  processAssistantQueue,
  transcribeTurn,
  undoTurn,
  type TurnEvent,
} from './queue';
import { startRecorder, type Recording, type Recorder } from './recorder';

const CAMERA_QUESTION = 'Fotos jetzt aufnehmen?';
const CAMERA_YES = 'Kamera öffnen';
const CAMERA_NO = 'Nicht jetzt';

export interface ControllerDeps {
  db: UserDb;
  /** Recordings are possible (the server transcribes). */
  voice: boolean;
  /** The day the diary shows now (today on other pages). */
  shownDate: () => ISODate;
  openPhoto: (search: { date: ISODate; meal: number }) => void;
}

export class AssistantController {
  private state: MachineState = initialState;
  private readonly listeners = new Set<() => void>();
  private stopQueue: (() => void) | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The turn the person waits for (its answer opens the bubble or the toast). */
  private waitingFor: number | null = null;
  private recorder: Recorder | null = null;
  /** The camera of a turn that answered late: opened when "Kamera öffnen" is tapped. */
  private camera: CameraOp | null = null;
  /**
   * The recording that turned into text mode (sent with the same key as the text). `failed`: no
   * text came back (offline, error), so "Senden" sends the recording itself.
   */
  private carriedRecording: { requestId: string; recording: Recording; failed?: boolean } | null = null;
  private disposed = false;

  constructor(private readonly deps: ControllerDeps) {}

  /** Starts listening to the queue; the returned function stops everything (unmount, sign-out). */
  attach(): () => void {
    this.disposed = false;
    this.stopQueue = onAssistantTurn((e) => this.onTurn(e));
    return () => this.dispose();
  }

  getState = () => this.state;
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Live sound level of the open microphone (0..1), for the listening bar. */
  get level(): number {
    return this.recorder?.level() ?? 0;
  }

  /** Seconds since the recording started (the button shows the time). */
  get recordedMs(): number {
    return this.recorder?.elapsed() ?? 0;
  }

  get recorderMaxMs(): number {
    return this.recorder?.maxMs ?? MAX_RECORD_MS;
  }

  private dispose() {
    this.disposed = true;
    this.stopQueue?.();
    this.stopQueue = null;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.recorder?.cancel();
    this.recorder = null;
  }

  private dispatch(e: MachineEvent) {
    const next = reduce(this.state, e);
    if (next === this.state) return;
    this.state = next;
    for (const l of this.listeners) l();
  }

  private later(key: string, ms: number, fn: () => void) {
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (!this.disposed) fn();
      }, ms),
    );
  }

  private cancel(key: string) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
  }

  /** A face for a moment (reactions of a figure). */
  mood(mood: Mood | null, ms?: number) {
    this.dispatch({ type: 'mood', mood });
    if (mood && ms) this.later('mood', ms, () => this.dispatch({ type: 'mood', mood: null }));
  }

  // ------------------------------------------------------------------ input

  tap() {
    const { phase } = this.state;
    this.dispatch({ type: 'hideKeys' });
    if (phase === 'recording') return void this.stopRecording();
    if (phase === 'typing') return void this.sendText();
    if (phase === 'listening') return void this.endListening();
    if (phase === 'idle' || phase === 'asking') {
      if (this.deps.voice) void this.startRecording();
      else this.keyboard();
    }
  }

  longPress() {
    const { phase } = this.state;
    if (!this.deps.voice) {
      if (phase === 'idle' || phase === 'asking') this.keyboard();
      return;
    }
    this.dispatch({ type: 'longPress' });
  }

  hideKeys() {
    this.dispatch({ type: 'hideKeys' });
  }

  /** Text mode. During a recording the recording becomes the text to edit. */
  keyboard() {
    const rec = this.recorder;
    if (this.state.phase === 'recording' && rec) {
      this.recorder = null;
      this.cancel('limit');
      this.dispatch({ type: 'keyboard', transcribing: true });
      void rec.stop().then(async (recording) => {
        const carried: { requestId: string; recording: Recording; failed?: boolean } = {
          requestId: uuidv7(),
          recording,
        };
        this.carriedRecording = carried;
        let text = '';
        try {
          text = await transcribeTurn(recording.blob, carried.requestId);
        } catch (e) {
          carried.failed = true;
          toast.error(errorMessage(e));
        }
        this.dispatch({ type: 'transcribed', text });
      });
      return;
    }
    if (this.state.phase === 'listening') this.endListening();
    this.dispatch({ type: 'keyboard', transcribing: false });
  }

  textChange(text: string) {
    this.dispatch({ type: 'textChange', text });
  }

  discard() {
    this.releaseMicrophone();
    this.carriedRecording = null;
    const wasRecording = this.state.phase === 'recording';
    this.dispatch({ type: 'discard' });
    if (wasRecording) this.mood('discarded', 1300);
  }

  /** A tap on an option of the bubble. */
  answer(option: string) {
    const bubble = this.state.bubble;
    if (!bubble) return;
    if (bubble.kind === 'camera') {
      this.dispatch({ type: 'closeBubble' });
      const cam = this.camera;
      this.camera = null;
      if (option === CAMERA_YES && cam) void this.openCamera(cam);
      return;
    }
    if (this.state.phase === 'thinking') return;
    // A recording or the open microphone ends unsent: the tapped option is the answer.
    this.endListening();
    this.releaseMicrophone();
    void this.send({ source: 'text', text: option }, true);
  }

  closeBubble() {
    const bubble = this.state.bubble;
    this.endListening();
    this.camera = null;
    if (bubble?.turnId != null) void closeQuestion(this.deps.db, bubble.turnId);
    this.dispatch({ type: 'closeBubble' });
  }

  // ------------------------------------------------------------------ recording

  private async startRecording() {
    this.dispatch({ type: 'startRecording' });
    let rec: Recorder;
    try {
      rec = await startRecorder();
    } catch (e) {
      this.dispatch({ type: 'recordFailed' });
      toast.error(recorderMessage(e));
      return;
    }
    // Kept only while this start is still wanted (no other recorder can have taken its place).
    if (this.disposed || this.state.phase !== 'starting' || this.recorder) return rec.cancel();
    this.recorder = rec;
    this.dispatch({ type: 'recording' });
    this.later('limit', rec.maxMs, () => void this.stopRecording());
  }

  /** Stops any recorder without sending (and the timers that would end it). */
  private releaseMicrophone() {
    this.recorder?.cancel();
    this.recorder = null;
    this.cancel('limit');
    this.cancel('listen');
    this.cancel('pause');
  }

  private async stopRecording() {
    const rec = this.recorder;
    this.recorder = null;
    this.cancel('limit');
    if (!rec) return;
    const recording = await rec.stop();
    if (recording.durationMs < 400) {
      // A tap and nothing said.
      this.dispatch({ type: 'discard' });
      return;
    }
    await this.send({ source: 'voice', recording }, false);
  }

  /** The open microphone after a question: the answer ends after a short pause, silence ends it all. */
  private async listen() {
    let rec: Recorder;
    try {
      rec = await startRecorder({
        onSpeech: () => this.heard(),
        onSilence: () => this.answerEnded(),
      });
    } catch {
      // No microphone without a tap (iOS): the bubble stays, tapping works as always.
      this.dispatch({ type: 'listenEnd' });
      return;
    }
    if (this.disposed || this.state.phase !== 'listening' || this.recorder) return rec.cancel();
    this.recorder = rec;
    this.later('listen', LISTEN_MS, () => {
      if (!this.state.hearing) this.endListening();
    });
    // An answer is a recording like any other: at most `MAX_RECORD_MS`.
    this.later('limit', rec.maxMs, () => void this.stopRecording());
  }

  private heard() {
    if (this.state.phase !== 'listening') return;
    this.cancel('listen');
    this.dispatch({ type: 'heard' });
  }

  private answerEnded() {
    if (this.state.phase !== 'listening' || !this.state.hearing) return;
    this.later('pause', 0, () => void this.stopRecording());
  }

  /** Closes the open microphone; the question waits for a tap. */
  private endListening() {
    if (this.state.phase !== 'listening') return;
    this.releaseMicrophone();
    this.dispatch({ type: 'listenEnd' });
  }

  // ------------------------------------------------------------------ sending

  private async sendText() {
    const text = this.state.text?.trim() ?? '';
    const carried = this.carriedRecording;
    // Still being transcribed, or no text came back: the recording goes as it is.
    if (!text && carried && (this.state.text === null || carried.failed)) {
      this.carriedRecording = null;
      return this.send(
        { source: 'voice', requestId: carried.requestId, recording: carried.recording },
        false,
      );
    }
    this.carriedRecording = null;
    if (!text) return this.discard();
    await this.send(
      carried
        ? { source: 'voice', text, requestId: carried.requestId, recording: carried.recording }
        : { source: 'text', text },
      true,
    );
  }

  private async send(
    input: { source: 'voice' | 'text'; text?: string; requestId?: string; recording?: Recording },
    typed: boolean,
  ) {
    const db = this.deps.db;
    const bubble = this.state.bubble;
    this.dispatch({ type: 'send', typed });
    let localId: number;
    try {
      const audio = input.recording && !input.text ? await input.recording.blob.arrayBuffer() : undefined;
      localId = await enqueueTurn(db, {
        source: input.source,
        shownDate: this.deps.shownDate(),
        ...(input.text && { text: input.text }),
        ...(audio && {
          audio,
          audioType: input.recording!.blob.type,
          durationMs: input.recording!.durationMs,
        }),
        ...(input.requestId && { requestId: input.requestId }),
        ...(bubble?.kind === 'question' && bubble.turnId != null && { answersTo: bubble.turnId }),
      });
    } catch (e) {
      // Not even stored (storage full, database closed): nothing waits, the button is free again.
      this.dispatch({ type: 'failed' });
      this.later('mood', 1500, () => this.dispatch({ type: 'mood', mood: null }));
      toast.error(errorMessage(e));
      return;
    }
    this.waitingFor = localId;
    await processAssistantQueue(db);
    const turn = await db.assistantTurns.get(localId);
    if (this.waitingFor === localId && turn?.status === 'waiting') {
      // No connection: it waits, the badge counts it.
      this.waitingFor = null;
      this.dispatch({ type: 'queued' });
    }
  }

  // ------------------------------------------------------------------ results

  private onTurn(e: TurnEvent) {
    const waited = e.turn.localId === this.waitingFor;
    if (waited) this.waitingFor = null;
    const late = e.late || !waited;
    if (e.error) {
      if (waited) {
        this.dispatch({ type: 'failed' });
        this.later('mood', 1500, () => this.dispatch({ type: 'mood', mood: null }));
        toast.error(e.error);
      }
      return;
    }
    const r = e.result!;
    const turn = e.turn;
    if (r.applied.length > 0) {
      const id = turn.localId!;
      toast(summaryText(r.applied), {
        action: {
          label: 'Rückgängig',
          onClick: () =>
            void undoTurn(this.deps.db, id).then((ok) => {
              if (ok) this.mood('undone', 1500);
            }),
        },
      });
    }
    let bubble: Bubble | null = null;
    if (turn.question) bubble = { turnId: turn.localId!, kind: 'question', ...turn.question };
    else if (r.camera && late) {
      this.camera = r.camera;
      bubble = { turnId: null, kind: 'camera', text: CAMERA_QUESTION, options: [CAMERA_YES, CAMERA_NO] };
    } else if (!r.applied.length && !r.camera && turn.reply)
      bubble = { turnId: null, kind: 'reply', text: turn.reply, options: [] };

    if (r.camera && !late) void this.openCamera(r.camera);
    if (!waited) {
      if (bubble) this.dispatch({ type: 'ask', bubble });
      return;
    }
    if (bubble) {
      // Not after an answer: an unclear answer must not keep the microphone coming back.
      const listen =
        bubble.kind === 'question' &&
        turn.source === 'voice' &&
        turn.answersTo == null &&
        !late &&
        !this.state.typed;
      this.dispatch({ type: 'result', bubble, listen: listen && this.deps.voice });
      if (this.state.phase === 'listening') void this.listen();
      return;
    }
    if (r.applied.length === 0 && !r.camera) {
      this.dispatch({ type: 'notUnderstood' });
      toast(r.skipped ? 'Eintrag nicht gefunden' : 'Nicht verstanden');
      this.later('confused', CONFUSED_MS, () => this.dispatch({ type: 'confusedEnd' }));
      return;
    }
    this.dispatch({ type: 'result', bubble: null, listen: false });
    this.later('mood', DONE_MS, () => this.dispatch({ type: 'mood', mood: null }));
  }

  private async openCamera(op: CameraOp) {
    const target = await targetFor(this.deps.db, op.date, op.meal, { now: Date.now(), today: todayOf() });
    storeAssistantHint(op.hint, op.replaces);
    this.deps.openPhoto(target);
  }
}

/** German message for a microphone that could not start (like the camera's). */
export function recorderMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Kein Zugriff auf das Mikrofon. Erlaube es in den Einstellungen des Browsers.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kein Mikrofon gefunden.';
  if (name === 'NotSupportedError') return 'Aufnahmen gehen in diesem Browser nicht.';
  return 'Das Mikrofon konnte nicht gestartet werden.';
}
