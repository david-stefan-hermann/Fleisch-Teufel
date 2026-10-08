import { useEffect } from 'react';

/**
 * Mirrors the visual viewport (`--vvh` height, `--vvt` offset from the layout viewport's top) as CSS
 * variables on `<html>`. iOS keeps the layout viewport (and `100dvh`) when the keyboard opens and only
 * shrinks and shifts the visual viewport; dialogs use the variables to stay above the keyboard.
 * Without `visualViewport` the CSS fallbacks (`100dvh`, `0px`) apply.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const style = document.documentElement.style;
    const update = () => {
      style.setProperty('--vvh', `${vv.height}px`);
      style.setProperty('--vvt', `${vv.offsetTop}px`);
    };
    const resize = () => {
      update();
      // Keep a focused dialog field visible once the keyboard has shrunk the viewport.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest('[data-slot=dialog-content]'))
        active.scrollIntoView({ block: 'nearest' });
    };
    update();
    vv.addEventListener('resize', resize);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', resize);
      vv.removeEventListener('scroll', update);
      style.removeProperty('--vvh');
      style.removeProperty('--vvt');
    };
  }, []);
}

/** Renders nothing; mounts `useVisualViewport` once for the signed-in area. */
export function ViewportVars(): null {
  useVisualViewport();
  return null;
}
