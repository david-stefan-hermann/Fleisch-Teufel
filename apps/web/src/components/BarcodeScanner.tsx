/**
 * Camera barcode scanner. Uses the native BarcodeDetector when available, otherwise the ZXing
 * WebAssembly ponyfill (self-hosted wasm, precached → works offline). iOS Safari requires
 * `playsInline` + `muted` for inline camera video in standalone mode.
 */
import { BarcodeDetector, prepareZXingModule } from 'barcode-detector/ponyfill';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { useEffect, useRef, useState } from 'react';

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

export function BarcodeScanner({
  onDetected,
  onError,
  paused,
}: {
  onDetected: (code: string) => void;
  onError: (e: ScannerError) => void;
  paused?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [torch, setTorch] = useState<MediaStreamTrack | null>(null);
  const [torchOn, setTorchOn] = useState(false);
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
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
        <div className="h-1/3 w-4/5 rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgb(0_0_0/0.35)]" />
      </div>
      {torch && (
        <button
          type="button"
          onClick={async () => {
            await torch
              .applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] })
              .catch(() => {});
            setTorchOn(!torchOn);
          }}
          className="absolute right-3 bottom-3 rounded-full bg-black/60 px-4 py-2 text-sm text-white focus-visible:ring-[3px] focus-visible:ring-white/60 focus-visible:outline-none"
          aria-pressed={torchOn}
        >
          {torchOn ? 'Licht aus' : 'Licht an'}
        </button>
      )}
    </div>
  );
}
