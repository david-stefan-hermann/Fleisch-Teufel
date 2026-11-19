import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

/** Space between the end of the text and its copy, as in `.marquee-track`. */
const GAP_PX = 32;
const SPEED_PX_PER_S = 28;
/** The share of a round that moves: the rest is the pause at the start (`@keyframes marquee`). */
const MOVING_SHARE = 0.78;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)');

function subscribeReducedMotion(onChange: () => void) {
  const media = reducedMotion();
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

/**
 * One line of text. When it does not fit, it runs through its place after a pause, endlessly and
 * without a seam (a second copy follows it); with reduced motion it is cut off instead.
 */
export function MarqueeText({ text, className }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflows, setOverflows] = useState(false);
  const still = useSyncExternalStore(
    subscribeReducedMotion,
    () => reducedMotion()?.matches ?? false,
    () => false,
  );

  useEffect(() => {
    const box = boxRef.current;
    const line = textRef.current;
    if (!box || !line || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const inset = parseFloat(getComputedStyle(box).paddingLeft) || 0;
      const room = box.getBoundingClientRect().width - inset;
      const width = line.getBoundingClientRect().width;
      const distance = width + GAP_PX;
      box.style.setProperty('--marquee-distance', `${distance}px`);
      box.style.setProperty(
        '--marquee-duration',
        `${(distance / SPEED_PX_PER_S / MOVING_SHARE).toFixed(1)}s`,
      );
      setOverflows(room > 0 && width > room + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(line);
    return () => observer.disconnect();
  }, []);

  const running = overflows && !still;
  return (
    <span ref={boxRef} className={cn('marquee', className)} data-running={running ? '' : undefined}>
      <span className="marquee-track">
        <span ref={textRef}>{text}</span>
        {running && <span aria-hidden="true">{text}</span>}
      </span>
    </span>
  );
}
