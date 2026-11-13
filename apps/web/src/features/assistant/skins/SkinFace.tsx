/**
 * What the button looks like: the standard icon in a circle, or a figure made of pictures (built in or
 * uploaded). One picture per step (listening, thinking, done), no alternating pictures; while it rests
 * a figure shows one of its idle faces now and then (every 10 to 20 s, first after `REST_MS`). The
 * ring, the badge, the time and the bubble are the same for every skin.
 */
import type { SkinManifest } from '@ft/shared';
import { ArrowUp, Mic } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { figureState, IDLE_FACE_MAX_MS, IDLE_FACE_MIN_MS, REST_MS, type MachineState } from '../machine';

/** The skin as the button needs it. */
export type SkinView =
  | { id: 'standard'; name: string; style: 'circle'; kind: 'standard' }
  | {
      id: string;
      name: string;
      style: 'circle' | 'free';
      kind: 'pictures';
      manifest: SkinManifest;
      /** Image key → URL (object URL for uploaded packs). */
      urls: Record<string, string>;
      /** Pixel art: where the picture sits so one drawn pixel is whole device pixels; null: smooth. */
      pixel: PixelBox | null;
    };

export const STANDARD_SKIN: SkinView = {
  id: 'standard',
  name: 'Standard',
  style: 'circle',
  kind: 'standard',
};

export interface PixelBox {
  size: number;
  x: number;
  y: number;
}

/**
 * Size and place of a pixel-art picture of `width` picture pixels drawn with `grid` picture pixels
 * per drawn pixel: a whole number of device pixels per drawn pixel, at most about 86 CSS px, on the
 * device pixel grid (256 px Teufelchen: 85,33 px at 3×, 64 px at 2×). Null when the screen is too
 * coarse for that (the picture is then smoothed).
 */
export function pixelBox(width: number, grid: number, dpr: number): PixelBox | null {
  const cells = width / grid;
  const k = Math.floor((86 * dpr) / cells);
  if (k < 1) return null;
  const size = (cells * k) / dpr;
  const snap = (v: number) => Math.round(v * dpr) / dpr;
  return { size, x: snap((56 - size) / 2), y: snap(56 - size + 2) };
}

/**
 * How far the visible button reaches beyond its 56 px box (CSS px before scaling), at the sides and
 * at the top: the state ring, the outline of a free figure, or a pixel-art picture larger than it.
 */
export function skinOverhang(skin: SkinView): { x: number; top: number } {
  if (skin.kind === 'pictures') {
    if (skin.pixel) return { x: Math.max(5, -skin.pixel.x), top: Math.max(5, -skin.pixel.y) };
    if (skin.style === 'free') return { x: 13, top: 16 };
  }
  return { x: 5, top: 5 };
}

const IDLE_SHOW_MS = 1900;

export function SkinFace({ skin, state, warn }: { skin: SkinView; state: MachineState; warn: boolean }) {
  if (skin.kind === 'standard') return <StandardFace state={state} />;
  return <PictureFace skin={skin} state={state} warn={warn} />;
}

/** Skin "Standard": microphone, stop, dots above, send. */
function StandardFace({ state }: { state: MachineState }) {
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

/** A figure cannot become an icon: the action it offers sits on a small sign. */
function ActSign({ state }: { state: MachineState }) {
  const p = state.phase;
  if (p === 'recording' || p === 'listening')
    return (
      <span className="ai-act">
        <i className="ai-stop" />
      </span>
    );
  if (p === 'typing')
    return (
      <span className="ai-act">
        <ArrowUp className="size-3.5" aria-hidden />
      </span>
    );
  if (p === 'idle' || p === 'asking')
    return (
      <span className="ai-act">
        <Mic className="size-[13px]" aria-hidden />
      </span>
    );
  return null;
}

/** Shows an idle face of the figure now and then while the button rests. */
function useIdleFace(faces: readonly string[], resting: boolean): string | null {
  const [face, setFace] = useState<string | null>(null);
  useEffect(() => {
    if (!resting || faces.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    let order: string[] = [];
    const next = (first: boolean) => {
      const wait = IDLE_FACE_MIN_MS + Math.random() * (IDLE_FACE_MAX_MS - IDLE_FACE_MIN_MS);
      timer = setTimeout(
        () => {
          if (order.length === 0) order = [...faces].sort(() => Math.random() - 0.5);
          setFace(order.pop()!);
          timer = setTimeout(() => {
            setFace(null);
            next(false);
          }, IDLE_SHOW_MS);
        },
        first ? Math.max(REST_MS, wait) : wait,
      );
    };
    next(true);
    return () => {
      clearTimeout(timer);
      setFace(null);
    };
  }, [faces, resting]);
  return resting ? face : null;
}

function PictureFace({
  skin,
  state,
  warn,
}: {
  skin: Extract<SkinView, { kind: 'pictures' }>;
  state: MachineState;
  warn: boolean;
}) {
  const m = skin.manifest;
  const resting = state.phase === 'idle' && !state.mood && !state.bubble && !state.keys;
  const idleFace = useIdleFace(m.idle, resting);
  const key = figureState(state, warn) as keyof typeof m.states;
  const image = idleFace ?? m.states[key] ?? m.states.idle!;
  const dots = state.phase === 'thinking' && (m.thinkingDots ?? !m.states.thinking);
  const px = skin.pixel;
  const cls = ['ai-pic', skin.style === 'free' && 'free', px && 'pixel'].filter(Boolean).join(' ');
  return (
    <>
      <span
        className={cls}
        style={
          px
            ? ({ '--px': `${px.size}px`, '--px-x': `${px.x}px`, '--px-y': `${px.y}px` } as CSSProperties)
            : undefined
        }
      >
        <img src={skin.urls[image] ?? skin.urls[m.states.idle!]} alt="" draggable={false} />
      </span>
      {dots && <ThinkingDots />}
      <ActSign state={state} />
    </>
  );
}
