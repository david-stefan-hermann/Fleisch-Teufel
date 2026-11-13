/**
 * The floating assistant button with what hangs on it: the small buttons (keyboard, discard), the
 * bubble (question or reply) and the text layer. It is carried by dragging and snaps to the left or
 * right edge; the position is kept per device (`ft.assistant.pos`) and pushed up by whatever sits at
 * the bottom (tab bar, page footer, toasts, the camera's controls: `[data-ai-avoid]`).
 */
import { RECORD_WARN_MS } from '@ft/shared';
import { Keyboard, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { AssistantController } from './controller';
import { DRAG_PX, LONG_PRESS_MS, LISTEN_MS, type MachineState } from './machine';
import { SkinFace, type SkinView } from './skins/SkinFace';

const S = 56;
const EDGE = 10;
const POS_KEY = 'ft.assistant.pos';

interface Pos {
  edge: 'left' | 'right';
  /** Distance from the top of the visual viewport; Infinity: as low as allowed. */
  y: number;
}

function readPos(): Pos {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') as Pos | null;
    if (v && (v.edge === 'left' || v.edge === 'right') && typeof v.y === 'number') return v;
  } catch {
    /* private mode or garbage: the default */
  }
  return { edge: 'right', y: Number.POSITIVE_INFINITY };
}

function writePos(p: Pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* the position holds until the app is closed */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The visible area and what the button must not cover at the bottom. */
function measure() {
  const vv = window.visualViewport;
  const top = vv?.offsetTop ?? 0;
  const height = vv?.height ?? window.innerHeight;
  const width = vv?.width ?? window.innerWidth;
  let floor = top + height;
  const obstacles = document.querySelectorAll(
    'nav[aria-label="Hauptnavigation"], [data-page-footer], [data-ai-avoid], [data-sonner-toast]',
  );
  for (const el of obstacles) {
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.top > top + height / 2) floor = Math.min(floor, r.top);
  }
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-top')) || 0;
  return { top, width, height, minY: top + safeTop + 60, maxY: floor - 12 - S };
}

/** Re-measures when the viewport, the page or the toasts change. */
function useLayoutTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
      // Toasts and sheets slide in: measure again once they are in place.
      clearTimeout(settle);
      settle = setTimeout(() => setTick((t) => t + 1), 450);
    };
    window.addEventListener('resize', bump);
    window.visualViewport?.addEventListener('resize', bump);
    window.visualViewport?.addEventListener('scroll', bump);
    const mo = new MutationObserver(bump);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      window.removeEventListener('resize', bump);
      window.visualViewport?.removeEventListener('resize', bump);
      window.visualViewport?.removeEventListener('scroll', bump);
      mo.disconnect();
    };
  }, []);
  return tick;
}

/** Re-renders every `ms` while `on` (the recording time). */
function useTicker(on: boolean, ms: number): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

export function AssistantButton({
  controller,
  waiting,
  skin,
}: {
  controller: AssistantController;
  waiting: number;
  skin: SkinView;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [pos, setPos] = useState(readPos);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    moved: boolean;
    long: boolean;
  } | null>(null);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutTick();
  const recording = state.phase === 'recording';
  useTicker(recording || state.phase === 'listening', 250);

  const m = measure();
  const typing = state.phase === 'typing';
  let x = pos.edge === 'left' ? EDGE : m.width - EDGE - S;
  let y = clamp(pos.y, m.minY, Math.max(m.minY, m.maxY));
  // Text mode: the button is "Senden" right above the keyboard.
  if (typing) y = m.top + m.height - S - 12;
  let edge = pos.edge;
  if (drag) {
    ({ x, y } = drag);
    edge = x + S / 2 < m.width / 2 ? 'left' : 'right';
  }

  const elapsed = controller.recordedMs;
  const remaining = controller.recorderMaxMs - elapsed;
  const warn = recording && remaining <= RECORD_WARN_MS;

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, moved: false, long: false };
    longTimer.current = setTimeout(() => {
      const p = press.current;
      if (!p || p.moved) return;
      p.long = true;
      controller.longPress();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || typing) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.moved && Math.hypot(dx, dy) > DRAG_PX) {
      p.moved = true;
      if (longTimer.current) clearTimeout(longTimer.current);
      if (state.phase === 'idle') controller.mood('carried');
    }
    if (p.moved)
      setDrag({ x: clamp(p.ox + dx, 0, m.width - S), y: clamp(p.oy + dy, m.top, m.top + m.height - S) });
  };
  const end = (tap: boolean) => () => {
    const p = press.current;
    press.current = null;
    if (longTimer.current) clearTimeout(longTimer.current);
    if (!p) return;
    if (p.moved && drag) {
      const next: Pos = { edge: drag.x + S / 2 < m.width / 2 ? 'left' : 'right', y: drag.y - m.top };
      setPos(next);
      writePos(next);
      setDrag(null);
      controller.mood('carried', 500);
      return;
    }
    if (p.moved) return;
    if (tap && !p.long) controller.tap();
  };

  const label =
    state.phase === 'recording'
      ? 'Aufnahme beenden und senden'
      : typing
        ? 'Senden'
        : state.phase === 'thinking'
          ? 'Assistent denkt'
          : 'Assistent: sprechen';

  const sideButtons: { key: string; label: string; icon: ReactNode; run: () => void }[] = [];
  if (recording || (state.keys && ['idle', 'asking', 'listening'].includes(state.phase)))
    sideButtons.push({
      key: 'keyboard',
      label: 'Tastatur',
      icon: <Keyboard className="size-5" aria-hidden />,
      run: () => controller.keyboard(),
    });
  if (recording || typing)
    sideButtons.push({
      key: 'discard',
      label: 'Verwerfen',
      icon: <X className="size-5" aria-hidden />,
      run: () => controller.discard(),
    });
  const sideH = sideButtons.length * 50;
  const above = y - m.minY > sideH + 8;

  return (
    <>
      {typing && <TextLayer controller={controller} state={state} />}
      {state.bubble && !typing && (
        <QuestionBubble controller={controller} state={state} x={x} y={y} edge={edge} m={m} />
      )}
      {sideButtons.length > 0 && (
        <div
          className="ai-side"
          data-dragging={drag ? '' : undefined}
          style={{
            flexDirection: above ? 'column' : 'column-reverse',
            transform: `translate(${x + 7}px, ${above ? y - sideH - 4 : y + S + 12}px)`,
          }}
        >
          {sideButtons.map((b) => (
            <button key={b.key} type="button" aria-label={b.label} onClick={b.run}>
              {b.icon}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="ai-btn"
        aria-label={label}
        data-state={state.phase}
        data-skin={skin.id}
        data-style={skin.style}
        data-edge={edge}
        data-warn={warn ? '' : undefined}
        data-dragging={drag ? '' : undefined}
        style={{ transform: `translate(${x}px, ${y}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end(true)}
        onPointerCancel={end(false)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            controller.tap();
          }
        }}
      >
        <span className="ai-ring" />
        <SkinFace skin={skin} state={state} warn={warn} lastSeconds={remaining <= 3000} />
        {waiting > 0 && <span className="ai-badge">{waiting}</span>}
        {recording && (
          <span className="ai-time" aria-live="off">
            {warn ? `noch ${Math.max(0, Math.ceil(remaining / 1000))} s` : clock(elapsed)}
          </span>
        )}
      </button>
    </>
  );
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function QuestionBubble({
  controller,
  state,
  x,
  y,
  edge,
  m,
}: {
  controller: AssistantController;
  state: MachineState;
  x: number;
  y: number;
  edge: 'left' | 'right';
  m: ReturnType<typeof measure>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(120);
  const bubble = state.bubble!;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const w = Math.min(260, m.width - S - 3 * EDGE - 8);
  const bx = edge === 'left' ? x + S + 10 : x - 10 - w;
  const by = clamp(y + S / 2 - h / 2, m.minY, Math.max(m.minY, m.maxY + S - h));
  return (
    <div
      ref={ref}
      className="ai-bubble"
      role="status"
      aria-live="polite"
      style={{ width: w, transform: `translate(${bx}px, ${by}px)` }}
    >
      <div className="flex items-start gap-1.5 font-semibold">
        <span className="flex-1">{bubble.text}</span>
        <button
          type="button"
          aria-label="Schließen"
          className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground"
          onClick={() => controller.closeBubble()}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {bubble.options.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {bubble.options.map((o) => (
            <button
              key={o}
              type="button"
              className="min-h-10 rounded-full border border-border bg-secondary px-3.5 py-1.5 font-semibold text-secondary-foreground"
              onClick={() => controller.answer(o)}
            >
              {o}
            </button>
          ))}
        </div>
      )}
      {state.phase === 'listening' && (
        <div className="ai-hear" data-on={state.hearing ? '' : undefined}>
          <i style={{ animationDuration: `${LISTEN_MS}ms` }} />
        </div>
      )}
    </div>
  );
}

function TextLayer({ controller, state }: { controller: AssistantController; state: MachineState }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = state.text;
  useEffect(() => {
    const ta = ref.current;
    if (!ta || text === null) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text]);
  const ready = text !== null;
  useEffect(() => {
    const ta = ref.current;
    if (!ready || !ta) return;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [ready]);
  return (
    <>
      <div className="ai-dim" onClick={() => ref.current?.focus()} />
      <div className="ai-typing">
        {text === null && <div className="ai-shimmer" />}
        <textarea
          ref={ref}
          rows={1}
          hidden={text === null}
          value={text ?? ''}
          enterKeyHint="send"
          maxLength={2000}
          aria-label="Was möchtest du eintragen?"
          placeholder="Schreib, was du sagen würdest"
          onChange={(e) => controller.textChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              controller.tap();
            }
            if (e.key === 'Escape') controller.discard();
          }}
        />
      </div>
    </>
  );
}
