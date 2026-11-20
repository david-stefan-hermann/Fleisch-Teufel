/**
 * Camera warm-up: the tap that opens a camera page already asks for the camera, so starting the
 * hardware (the slow part on iOS) runs in parallel with the page change instead of after it. The
 * request has to come from the tap handler: iOS only counts it as a user gesture there.
 *
 * A warm stream nobody picks up within `WARM_MS` (tap and straight back) is stopped, so the camera
 * never runs without a visible picture for longer than that.
 */

const MAIN_CAMERA_KEY = 'ft.camera.main';

/**
 * The one camera request of the app: warm-up and scanner must ask for exactly the same stream, so
 * both call this. A main camera remembered by the scanner (`rememberMainCamera`) goes along as an
 * ideal device id; an id that no longer exists falls back to the back camera.
 */
export function cameraConstraints(): MediaStreamConstraints {
  let id: string | null = null;
  try {
    id = localStorage.getItem(MAIN_CAMERA_KEY);
  } catch {
    // Private mode: the back camera the browser picks.
  }
  return {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1440 },
      ...(id ? { deviceId: { ideal: id } } : {}),
    },
  };
}

export function rememberMainCamera(id: string): void {
  try {
    localStorage.setItem(MAIN_CAMERA_KEY, id);
  } catch {
    // Then the switch happens again on the next start.
  }
}

/** Drops a remembered main camera; true when there was one (the caller then asks once more without it). */
export function forgetMainCamera(): boolean {
  try {
    if (localStorage.getItem(MAIN_CAMERA_KEY) === null) return false;
    localStorage.removeItem(MAIN_CAMERA_KEY);
    return true;
  } catch {
    return false;
  }
}

export const WARM_MS = 3000;

const stop = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

let warm: { stream: Promise<MediaStream | null>; timer: ReturnType<typeof setTimeout> } | null = null;

/** Starts the camera for a page that is about to open. Call only from a tap handler. */
export function warmUpCamera(): void {
  if (warm || !navigator.mediaDevices?.getUserMedia) return;
  // Errors are swallowed: the scanner then asks again and shows its own message.
  const stream = navigator.mediaDevices.getUserMedia(cameraConstraints()).then(
    (s) => s,
    () => null,
  );
  const entry = {
    stream,
    timer: setTimeout(() => {
      if (warm === entry) warm = null;
      void stream.then(stop);
    }, WARM_MS),
  };
  warm = entry;
}

/**
 * Hands out the warmed-up stream once. Resolves to null when there was no warm-up, it failed, or
 * the stream has ended meanwhile; the caller then asks with `getUserMedia` itself.
 */
export async function takeWarmStream(): Promise<MediaStream | null> {
  const entry = warm;
  if (!entry) return null;
  warm = null;
  clearTimeout(entry.timer);
  const stream = await entry.stream;
  if (!stream || stream.getVideoTracks().every((t) => t.readyState === 'ended')) return null;
  return stream;
}

/** Stops a pending warm-up (tests, and pages that know they will not show the camera). */
export function cancelWarmUp(): void {
  const entry = warm;
  if (!entry) return;
  warm = null;
  clearTimeout(entry.timer);
  void entry.stream.then(stop);
}
