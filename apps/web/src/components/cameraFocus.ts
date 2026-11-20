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

const INFO_KEY = 'ft.cameraInfo';

/**
 * Which camera runs and which there are, once per device and camera label, into the error log
 * ("Daten & Sync", copyable): only when the device names more than one back camera, the case where
 * the browser may have picked a wide-angle one that cannot focus close up.
 */
export async function logCameraInfo(track: MediaStreamTrack, log: (text: string) => void): Promise<void> {
  try {
    const label = track.label;
    const seen = JSON.parse(localStorage.getItem(INFO_KEY) ?? '[]') as string[];
    if (seen.includes(label)) return;
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (inputs.filter(isBack).length < 2) return;
    const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[]; focusDistance?: unknown };
    const id = track.getSettings?.().deviceId ?? '';
    log(
      [
        `Kamera: ${label || '?'} (${id.slice(0, 8)})`,
        `focusMode: ${JSON.stringify(caps.focusMode ?? null)}`,
        `focusDistance: ${JSON.stringify(caps.focusDistance ?? null)}`,
        `Videoeingänge: ${inputs.map((d) => d.label || '?').join(' | ')}`,
      ].join('; '),
    );
    localStorage.setItem(INFO_KEY, JSON.stringify([...seen, label].slice(-10)));
  } catch {
    // Diagnostics only.
  }
}

const isBack = (d: MediaDeviceInfo) => /back|rück/i.test(d.label);
