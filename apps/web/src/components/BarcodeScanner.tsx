/**
 * Camera barcode scanner. Uses the native BarcodeDetector when available, otherwise the ZXing
 * WebAssembly ponyfill (self-hosted wasm, precached → works offline). iOS Safari requires
 * `playsInline` + `muted` for inline camera video in standalone mode.
 */
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { Flashlight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export type ScannerError = 'permission' | 'no-camera' | 'unsupported' | 'other';

/** Valid EAN/UPC check digit (avoids misreads). */
export function validGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Finds an EAN/UPC in a still image (a photographed barcode). Detection runs on a downscaled copy:
 * fast enough on phones, and a barcode filling a decent part of the frame survives ~1600 px wide.
 * QR codes count only if they carry a plain GTIN. Returns null when nothing valid is found.
 */
export async function detectBarcodeInImage(blob: Blob): Promise<string | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const detector = new BarcodeDetector({ formats: [...FORMATS, 'qr_code'] });
    const codes = await detector.detect(canvas);
    return codes.map((c) => c.rawValue.trim()).find(validGtin) ?? null;
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/** Takes a still from the live camera (full sensor resolution of the stream) as JPEG. */
export type CaptureFn = () => Promise<Blob | null>;

/** Torch of the running camera; null while there is none (iOS rarely reports `torch`). */
export type TorchState = { on: boolean; toggle: () => void } | null;

/**
 * Icon button for the torch, styled for the dark camera overlay. The icon is always the flashlight;
 * the state shows in the button itself: dark while off, an inverted white circle while on.
 */
export function TorchButton({ torch, className }: { torch: NonNullable<TorchState>; className?: string }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-lg"
      className={cn(
        torch.on
          ? 'rounded-full bg-white text-black hover:bg-white/90'
          : 'rounded-xl bg-black/55 text-white hover:bg-black/70',
        className,
      )}
      aria-label={torch.on ? 'Licht ausschalten' : 'Licht einschalten'}
      aria-pressed={torch.on}
      onClick={torch.toggle}
    >
      <Flashlight className="size-6" aria-hidden />
    </Button>
  );
}

export function BarcodeScanner({
  onDetected,
  onError,
  paused,
  captureRef,
  children,
  frame = 'barcode',
  onTorchState,
}: {
  onDetected: (code: string) => void;
  onError: (e: ScannerError) => void;
  paused?: boolean;
  /** Receives a capture function once the camera runs (photo mode). */
  captureRef?: RefObject<CaptureFn | null>;
  /** Overlay controls (shutter, gallery, …) rendered above the video. */
  children?: ReactNode;
  /** 'barcode': dimmed frame for scanning; 'photo': light corner marks only. */
  frame?: 'barcode' | 'photo';
  /**
   * Reports the torch to the parent, which renders the toggle itself (e.g. in its own overlay).
   * Without it the scanner shows its own toggle top right. Pass a state setter (stable identity).
   */
  onTorchState?: (s: TorchState) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = async () => {
      const v = video.current;
      if (!v || v.readyState < 2 || !v.videoWidth) return null;
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext('2d')!.drawImage(v, 0, 0);
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    };
    return () => {
      captureRef.current = null;
    };
  }, [captureRef]);
  const [torch, setTorch] = useState<MediaStreamTrack | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const toggleTorch = useCallback(() => {
    if (!torch) return;
    const on = !torchOn;
    // Only flip the state once the camera accepted it, so a refused torch never shows as on.
    void torch
      .applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      .then(() => setTorchOn(on))
      .catch(() => {});
  }, [torch, torchOn]);
  useEffect(() => {
    onTorchState?.(torch ? { on: torchOn, toggle: toggleTorch } : null);
  }, [torch, torchOn, toggleTorch, onTorchState]);
  // The parent's toggle must not outlive the camera.
  useEffect(() => () => onTorchState?.(null), [onTorchState]);
  const pausedRef = useRef(paused);
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    pausedRef.current = paused;
    onDetectedRef.current = onDetected;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    // Require the same code twice in a row to suppress single-frame misreads.
    let last = '';
    let streak = 0;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) return onError('unsupported');
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        });
      } catch (e) {
        const name = (e as DOMException).name;
        return onError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'permission'
            : name === 'NotFoundError'
              ? 'no-camera'
              : 'other',
        );
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      if (track && caps.torch) setTorch(track);
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const detector = new BarcodeDetector({ formats: [...FORMATS] });
      const loop = async () => {
        if (stopped) return;
        if (!pausedRef.current && v.readyState >= 2) {
          try {
            const codes = await detector.detect(v);
            const code = codes.map((c) => c.rawValue).find(validGtin);
            if (code) {
              streak = code === last ? streak + 1 : 1;
              last = code;
              if (streak >= 2) {
                streak = 0;
                navigator.vibrate?.(40);
                onDetectedRef.current(code);
              }
            }
          } catch {
            /* frame not ready */
          }
        }
        raf = window.setTimeout(() => void loop(), 120) as unknown as number;
      };
      void loop();
    }
    void start();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onError]);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={video}
        className="aspect-[3/4] w-full object-cover"
        playsInline
        muted
        autoPlay
        aria-label="Kamerabild"
      />
      {frame === 'barcode' ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <div className="h-1/3 w-4/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
        </div>
      ) : (
        <div className="pointer-events-none absolute inset-6 bottom-28" aria-hidden>
          {(
            [
              'top-0 left-0 border-t-2 border-l-2',
              'top-0 right-0 border-t-2 border-r-2',
              'bottom-0 left-0 border-b-2 border-l-2',
              'bottom-0 right-0 border-b-2 border-r-2',
            ] as const
          ).map((c) => (
            <span key={c} className={`absolute size-6 border-white/80 ${c}`} />
          ))}
        </div>
      )}
      {torch && !onTorchState && (
        <TorchButton torch={{ on: torchOn, toggle: toggleTorch }} className="absolute top-3 right-3" />
      )}
      {children}
    </div>
  );
}
