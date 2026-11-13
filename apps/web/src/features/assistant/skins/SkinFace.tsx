/**
 * What the button looks like: the standard icon in a circle, or a figure made of pictures (built in or
 * uploaded, `PictureSkin`). The ring, the badge, the time and the bubble are the same for every skin.
 */
import { ArrowUp, Mic } from 'lucide-react';
import type { MachineState } from '../machine';

/** The skin as the button needs it. */
export type SkinView =
  | { id: 'standard'; style: 'circle'; kind: 'standard' }
  | {
      id: string;
      style: 'circle' | 'free';
      kind: 'pictures';
      pixelArt: boolean;
      thinkingDots: boolean;
      /** Object URL per state key (`idle` always there). */
      pictures: Record<string, string>;
      /** Faces it shows by itself while resting. */
      idle: string[];
    };

export const STANDARD_SKIN: SkinView = { id: 'standard', style: 'circle', kind: 'standard' };

export function SkinFace({
  skin,
  state,
  warn,
}: {
  skin: SkinView;
  state: MachineState;
  warn: boolean;
  lastSeconds: boolean;
}) {
  if (skin.kind === 'standard') return <StandardFace state={state} />;
  return <StandardFace state={state} warn={warn} />;
}

/** Skin "Standard": microphone, stop, dots, send. */
function StandardFace({ state }: { state: MachineState; warn?: boolean }) {
  const p = state.phase;
  const icon =
    p === 'recording' || p === 'listening' ? (
      <i className="ai-stop" />
    ) : p === 'typing' ? (
      <ArrowUp className="size-[26px]" strokeWidth={2.4} aria-hidden />
    ) : (
      <Mic
        className="size-[26px]"
        strokeWidth={2.2}
        aria-hidden
        style={p === 'starting' || p === 'thinking' ? { opacity: 0.5 } : undefined}
      />
    );
  return (
    <>
      <span className="ai-face">{icon}</span>
      {p === 'thinking' && <ThinkingDots />}
    </>
  );
}

export function ThinkingDots() {
  return (
    <span className="ai-pthink ai-dots" aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}
