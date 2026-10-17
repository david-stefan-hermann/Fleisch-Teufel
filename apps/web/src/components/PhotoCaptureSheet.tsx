import { Images, X } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  BarcodeScanner,
  CAM_ERRORS,
  TorchButton,
  type CaptureFn,
  type ScannerError,
  type TorchState,
} from '@/components/BarcodeScanner';
import { FullscreenOverlay } from '@/components/FullscreenOverlay';
import { useObjectUrl } from '@/components/MealPhoto';
import { Button } from '@/components/ui/button';
import { compressImage, type ImagePreset } from '@/features/ai/image';

/** A photo taken or picked in the sheet; `id` is its identity while the sheet is open. */
export interface CapturedShot {
  id: number;
  blob: Blob;
}

const ignoreCode = () => {};

/**
 * Full-screen camera for a few photos at once: live camera with shutter and torch, the photo library
 * (several at once), the taken photos as a strip with X, and a footer button that hands them over.
 * Without a camera it falls back to the library. The photos only live in memory while the sheet is
 * open. With `preset` every photo is compressed as it is added (keeps memory low on iOS).
 *
 * Used for the label reading of the custom food editor (`LabelCaptureSheet`, which adds barcode
 * detection through `onLiveCode`/`onAdded`) and for adding photos to a meal analysis.
 */
export function PhotoCaptureSheet({
  title,
  max,
  preset,
  busy = false,
  closeLabel,
  footerLabel,
  hint,
  onSubmit,
  onClose,
  onAdded,
  onRemoved,
  onLiveCode = ignoreCode,
  overlay,
}: {
  title: string;
  /** Most photos the sheet takes. */
  max: number;
  preset?: ImagePreset;
  /** Work running on the photos (e.g. the label call): camera paused, controls locked. */
  busy?: boolean;
  closeLabel?: string;
  /** Text of the footer button for `n` photos. */
  footerLabel: (n: number) => string;
  /** Line under the camera. */
  hint: string;
  onSubmit: (photos: Blob[]) => void;
  onClose: () => void;
  onAdded?: (shot: CapturedShot) => void;
  onRemoved?: (id: number) => void;
  /** A barcode the live camera read (stable callback). */
  onLiveCode?: (code: string) => void;
  /** Extra layer over the camera (a barcode chip, an analysis overlay). */
  overlay?: ReactNode;
}) {
  const capture = useRef<CaptureFn | null>(null);
  const library = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const [camError, setCamError] = useState<ScannerError | null>(null);
  const [torch, setTorch] = useState<TorchState>(null);
  // The shutter waits for the first camera frame.
  const [camReady, setCamReady] = useState(false);
  const onReady = useCallback(() => setCamReady(true), []);
  const onError = useCallback((e: ScannerError) => setCamError(e), []);
  // Photos being compressed; they count against `max` already.
  const [adding, setAdding] = useState(0);
  const full = shots.length + adding >= max;
  const locked = busy || adding > 0;

  async function add(blobs: Blob[]) {
    const room = max - shots.length - adding;
    if (blobs.length > room) toast(`Höchstens ${max} ${max === 1 ? 'Foto' : 'Fotos'}.`);
    const taken = blobs.slice(0, Math.max(0, room));
    if (taken.length === 0) return;
    setAdding((n) => n + taken.length);
    const added: CapturedShot[] = [];
    for (const blob of taken) {
      try {
        added.push({ id: nextId.current++, blob: preset ? await compressImage(blob, preset) : blob });
      } catch {
        toast.error('Ein Foto konnte nicht gelesen werden. Versuche ein anderes Foto.');
      }
    }
    setAdding((n) => n - taken.length);
    setShots((s) => [...s, ...added]);
    for (const shot of added) onAdded?.(shot);
  }

  async function shoot() {
    const blob = await capture.current?.();
    if (!blob) return toast.error('Die Kamera liefert noch kein Bild.');
    navigator.vibrate?.(30);
    void add([blob]);
  }

  function remove(id: number) {
    setShots((all) => all.filter((x) => x.id !== id));
    onRemoved?.(id);
  }

  const strip = shots.length > 0 && (
    <ul className="absolute inset-x-5 bottom-24 z-10 flex gap-3" aria-label="Fotos">
      {shots.map((s, i) => (
        <ShotThumb key={s.id} shot={s} index={i} disabled={busy} onRemove={() => remove(s.id)} />
      ))}
    </ul>
  );

  return (
    <FullscreenOverlay
      title={title}
      onClose={onClose}
      {...(closeLabel ? { closeLabel } : {})}
      footer={
        <Button
          size="lg"
          disabled={locked || shots.length === 0}
          onClick={() => onSubmit(shots.map((s) => s.blob))}
        >
          {footerLabel(shots.length)}
        </Button>
      }
    >
      <input
        ref={library}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {camError ? (
        <div className="relative grid min-h-[28rem] content-start gap-4 overflow-hidden rounded-2xl border p-4 pb-40">
          <p role="alert" className="text-sm">
            {CAM_ERRORS[camError]} Wähle die Fotos aus der Mediathek.
          </p>
          <Button
            variant="outline"
            className="h-20 flex-col gap-1"
            disabled={busy || full}
            onClick={() => library.current?.click()}
          >
            <Images className="size-6 text-primary" aria-hidden /> Aus Mediathek
          </Button>
          {strip}
          {overlay}
        </div>
      ) : (
        <BarcodeScanner
          frame="photo"
          onDetected={onLiveCode}
          onError={onError}
          paused={busy}
          captureRef={capture}
          onTorchState={setTorch}
          onReady={onReady}
        >
          {strip}
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-4">
            <Button
              variant="secondary"
              size="icon-lg"
              className="rounded-xl bg-black/55 text-white hover:bg-black/70"
              aria-label="Fotos aus der Mediathek"
              disabled={busy || full}
              onClick={() => library.current?.click()}
            >
              <Images className="size-6" aria-hidden />
            </Button>
            <button
              type="button"
              aria-label="Foto aufnehmen"
              disabled={busy || full || !camReady}
              onClick={() => void shoot()}
              className="grid size-[4.5rem] touch-manipulation place-items-center rounded-full border-4 border-white/90 bg-white/20 backdrop-blur-sm transition-transform active:scale-95 disabled:opacity-40 focus-visible:ring-[3px] focus-visible:ring-white/60 focus-visible:outline-none motion-reduce:transition-none"
            >
              <span className="size-14 rounded-full bg-white" aria-hidden />
            </button>
            {torch ? <TorchButton torch={torch} /> : <span className="size-11" aria-hidden />}
          </div>
          {overlay}
        </BarcodeScanner>
      )}
      <p className="mt-3 text-center text-sm text-muted-foreground">{hint}</p>
    </FullscreenOverlay>
  );
}

function ShotThumb({
  shot,
  index,
  disabled,
  onRemove,
}: {
  shot: CapturedShot;
  index: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  const url = useObjectUrl(shot.blob, `shot:${shot.id}`);
  return (
    <li className="relative size-16 shrink-0">
      {url && (
        <img
          src={url}
          alt={`Foto ${index + 1}`}
          className="size-16 rounded-xl border-2 border-white object-cover shadow-lg"
        />
      )}
      {!disabled && (
        <button
          type="button"
          aria-label={`Foto ${index + 1} entfernen`}
          onClick={onRemove}
          // Small on purpose (it sits on the photo); the invisible ring makes the touch target 44 px.
          className="absolute -top-2.5 -right-2.5 grid size-7 place-items-center rounded-full border-2 border-white bg-neutral-800 text-white after:absolute after:-inset-2 focus-visible:ring-[3px] focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <X className="size-3.5" strokeWidth={3} aria-hidden />
        </button>
      )}
    </li>
  );
}
