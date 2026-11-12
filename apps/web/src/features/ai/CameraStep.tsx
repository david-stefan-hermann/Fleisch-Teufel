import { MAX_ANALYSIS_PHOTOS } from '@ft/shared';
import { Camera, Images } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  BarcodeScanner,
  CAM_ERRORS,
  detectBarcodeInImage,
  TorchButton,
  type CaptureFn,
  type ScannerError,
  type TorchState,
} from '@/components/BarcodeScanner';
import { Button } from '@/components/ui/button';

/**
 * Live camera as the single entry point: a barcode in view is looked up immediately, the shutter
 * takes the frame for the preview, the gallery button (bottom left) picks a saved photo (one with a
 * barcode goes straight to the product lookup), the torch toggle sits bottom right when the camera
 * has one.
 *
 * iOS limit: a file input without `capture` always opens the action sheet (photo library / take
 * photo / choose file); no web API opens the photo library directly.
 */
export function CameraCapture({
  busy: adding,
  onShots,
  onBarcode,
}: {
  /** Photos being prepared for the preview. */
  busy: boolean;
  onShots: (photos: Blob[]) => void;
  onBarcode: (code: string) => void;
}) {
  const galleryInput = useRef<HTMLInputElement>(null);
  const fallbackCamera = useRef<HTMLInputElement>(null);
  const capture = useRef<CaptureFn | null>(null);
  const [camError, setCamError] = useState<ScannerError | null>(null);
  const [torch, setTorch] = useState<TorchState>(null);
  // The shutter waits for the first camera frame.
  const [camReady, setCamReady] = useState(false);
  const onReady = useCallback(() => setCamReady(true), []);
  // While a picked photo is checked for a barcode.
  const [busy, setBusy] = useState(false);
  const onError = useCallback((e: ScannerError) => setCamError(e), []);
  const barcodeSeen = useRef(false);
  const onDetected = useCallback(
    (code: string) => {
      if (barcodeSeen.current) return;
      barcodeSeen.current = true;
      toast(`Barcode ${code} erkannt`);
      onBarcode(code);
    },
    [onBarcode],
  );

  async function shoot() {
    const blob = await capture.current?.();
    if (!blob) return toast.error('Die Kamera liefert noch kein Bild.');
    navigator.vibrate?.(30);
    onShots([blob]);
  }

  /** Picked photos: one with a barcode goes to the product lookup, several go to the preview together. */
  async function pick(files: File[]) {
    if (files.length === 0) return;
    if (files.length > MAX_ANALYSIS_PHOTOS) toast(`Höchstens ${MAX_ANALYSIS_PHOTOS} Fotos.`);
    if (files.length === 1) {
      setBusy(true);
      // A photographed barcode skips the AI entirely and goes to the product lookup.
      const code = await detectBarcodeInImage(files[0]!);
      setBusy(false);
      if (code) return onDetected(code);
    }
    onShots(files.slice(0, MAX_ANALYSIS_PHOTOS));
  }

  const overlay = (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-4">
      <Button
        variant="secondary"
        size="icon-lg"
        className="rounded-xl bg-black/55 text-white hover:bg-black/70"
        aria-label="Aus der Mediathek wählen"
        disabled={busy || adding}
        onClick={() => galleryInput.current?.click()}
      >
        <Images className="size-6" aria-hidden />
      </Button>
      <button
        type="button"
        aria-label="Foto aufnehmen"
        disabled={busy || adding || !camReady}
        onClick={() => void shoot()}
        className="grid size-[4.5rem] touch-manipulation place-items-center rounded-full border-4 border-white/90 bg-white/20 backdrop-blur-sm transition-transform active:scale-95 disabled:opacity-50 focus-visible:ring-[3px] focus-visible:ring-white/60 focus-visible:outline-none motion-reduce:transition-none"
      >
        <span className="size-14 rounded-full bg-white" aria-hidden />
      </button>
      {torch ? (
        <TorchButton torch={torch} />
      ) : (
        // Keeps the shutter centered when the camera reports no torch.
        <span className="size-11" aria-hidden />
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pick([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {camError ? (
        <div className="grid gap-3 rounded-2xl border p-4">
          <p role="alert" className="text-sm">
            {CAM_ERRORS[camError]} Du kannst stattdessen ein Foto mit der Kamera-App aufnehmen oder aus der
            Mediathek wählen.
          </p>
          <input
            ref={fallbackCamera}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void pick([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => fallbackCamera.current?.click()}
            >
              <Camera className="size-7 text-primary" aria-hidden /> Foto aufnehmen
            </Button>
            <Button
              variant="outline"
              className="h-24 flex-col gap-2"
              onClick={() => galleryInput.current?.click()}
            >
              <Images className="size-7 text-primary" aria-hidden /> Aus Mediathek
            </Button>
          </div>
        </div>
      ) : (
        <BarcodeScanner
          frame="photo"
          onDetected={onDetected}
          onError={onError}
          paused={busy}
          captureRef={capture}
          onTorchState={setTorch}
          onReady={onReady}
        >
          {overlay}
        </BarcodeScanner>
      )}
    </div>
  );
}
