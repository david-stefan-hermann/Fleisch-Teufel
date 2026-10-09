/**
 * Camera warm-up: the tap that opens a camera page already asks for the camera, so starting the
 * hardware (the slow part on iOS) runs in parallel with the page change instead of after it. The
 * request has to come from the tap handler: iOS only counts it as a user gesture there.
 *
 * A warm stream nobody picks up within `WARM_MS` (tap and straight back) is stopped, so the camera
 * never runs without a visible picture for longer than that.
 */

/** The one camera request of the app: warm-up and scanner must ask for exactly the same stream. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
};

export const WARM_MS = 3000;

const stop = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop());

let warm: { stream: Promise<MediaStream | null>; timer: ReturnType<typeof setTimeout> } | null = null;

/** Starts the camera for a page that is about to open. Call only from a tap handler. */
export function warmUpCamera(): void {
  if (warm || !navigator.mediaDevices?.getUserMedia) return;
  // Errors are swallowed: the scanner then asks again and shows its own message.
  const stream = navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS).then(
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
