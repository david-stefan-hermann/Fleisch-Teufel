/**
 * Focus of the running camera, only through what its track reports (Chrome on Android reports
 * `focusMode`; iOS reports nothing, so nothing changes there). Every refused constraint is
 * swallowed: focus is a help, never an error.
 */

/** How long a tapped focus point holds before the camera focuses continuously again. */
export const FOCUS_HOLD_MS = 5000;

interface FocusCapabilities {
  focusMode?: string[];
}

export function focusModes(track: MediaStreamTrack): string[] {
  try {
    return (track.getCapabilities?.() as FocusCapabilities | undefined)?.focusMode ?? [];
  } catch {
    return [];
  }
}

const apply = (track: MediaStreamTrack, set: Record<string, unknown>) =>
  track.applyConstraints({ advanced: [set as MediaTrackConstraintSet] }).catch(() => {});

/** Continuous autofocus when the camera offers it (close-ups of a nutrition label). */
export async function startAutofocus(track: MediaStreamTrack): Promise<void> {
  if (focusModes(track).includes('continuous')) await apply(track, { focusMode: 'continuous' });
}

/** A tap can set the focus point: focus modes and `pointsOfInterest` (not part of the capabilities). */
export function canTapFocus(track: MediaStreamTrack): boolean {
  const supported = navigator.mediaDevices?.getSupportedConstraints?.() as
    Record<string, boolean> | undefined;
  return focusModes(track).length > 0 && !!supported?.pointsOfInterest;
}

const holds = new WeakMap<MediaStreamTrack, ReturnType<typeof setTimeout>>();

/** Focuses at `point` (0 to 1 in the picture), then continuously again after `FOCUS_HOLD_MS`. */
export async function focusAt(track: MediaStreamTrack, point: { x: number; y: number }): Promise<void> {
  stopFocus(track);
  const modes = focusModes(track);
  const mode = modes.includes('single-shot') ? 'single-shot' : 'continuous';
  await apply(track, { pointsOfInterest: [point], focusMode: mode });
  if (!modes.includes('continuous')) return;
  holds.set(
    track,
    setTimeout(() => {
      holds.delete(track);
      void apply(track, { focusMode: 'continuous' });
    }, FOCUS_HOLD_MS),
  );
}

/** Drops a pending return to continuous focus (next tap, camera stopped). */
export function stopFocus(track: MediaStreamTrack): void {
  clearTimeout(holds.get(track));
  holds.delete(track);
}

/** A tap at (x, y) in an element of boxW × boxH showing the video with `object-cover`, as 0 to 1. */
export function coverPoint({
  boxW,
  boxH,
  videoW,
  videoH,
  x,
  y,
}: {
  boxW: number;
  boxH: number;
  videoW: number;
  videoH: number;
  x: number;
  y: number;
}): { x: number; y: number } {
  const s = Math.max(boxW / videoW, boxH / videoH);
  const w = videoW * s;
  const h = videoH * s;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((x + (w - boxW) / 2) / w), y: clamp((y + (h - boxH) / 2) / h) };
}
