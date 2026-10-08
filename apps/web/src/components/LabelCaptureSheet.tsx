import type { AiLabelResult } from '@ft/shared';
import { Check, Images, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay';
import {
  BarcodeScanner,
  CAM_ERRORS,
  detectBarcodeInImage,
  TorchButton,
  type CaptureFn,
  type ScannerError,
  type TorchState,
} from '@/components/BarcodeScanner';
import { FullscreenOverlay } from '@/components/FullscreenOverlay';
import { useObjectUrl } from '@/components/MealPhoto';
import { Button } from '@/components/ui/button';
import { compressImage } from '@/features/ai/image';
import { ApiError, endpoints, errorMessage, OfflineError } from '@/lib/api';

/** Front, nutrition table and barcode: all go to Claude in one call. */
export const MAX_LABEL_PHOTOS = 3;
/** Label text needs more pixels than a plate photo (small print in the nutrition table). */
const LABEL_PIXELS = 2_000_000;

const LABEL_STEPS = ['Suche die Nährwerttabelle', 'Lese die Werte ab', 'Prüfe den Barcode'] as const;

const UNREADABLE =
  'Das Etikett konnte nicht gelesen werden. Versuche ein schärferes Foto der Nährwerttabelle.';

/** Error toast of the label call (I7); offline and limits get the texts of the meal analysis. */
export function labelErrorMessage(e: unknown): string {
  if (e instanceof ApiError && ['no_label', 'no_result', 'refused'].includes(e.code)) return UNREADABLE;
  if (e instanceof ApiError && e.code === 'too_many_requests')
    return 'Zu viele Analysen in kurzer Zeit. Versuche es in ein paar Minuten erneut.';
  return errorMessage(e);
}

interface Shot {
  id: number;
  blob: Blob;
}

/**
 * "Etikett fotografieren" above the custom food editor: live camera (or the photo library) for up
 * to three photos of one package, then one Claude call reads name, brand, barcode and nutrients.
 * The barcode is read locally first (live scanner and every photo, check digit included) and
 * shown as a chip; it wins over the model's reading. Nothing is stored: the photos only live in
 * memory while this layer is open. X during the analysis cancels it (the server finishes the call,
 * its answer is dropped).
 */
export function LabelCaptureSheet({
  onResult,
  onClose,
}: {
  onResult: (label: AiLabelResult, localBarcode: string | null) => void;
  onClose: () => void;
}) {
  const capture = useRef<CaptureFn | null>(null);
  const library = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);
  const request = useRef<AbortController | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  /** Valid codes seen by the live scanner or found in a photo (by shot id, 0 = live). */
  const [codes, setCodes] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [camError, setCamError] = useState<ScannerError | null>(null);
  const [torch, setTorch] = useState<TorchState>(null);
  const [busy, setBusy] = useState(false);
  const onError = useCallback((e: ScannerError) => setCamError(e), []);
  const onDetected = useCallback(
    (code: string) => setCodes((m) => (m.get(0) === code ? m : new Map(m).set(0, code))),
    [],
  );
  const full = shots.length >= MAX_LABEL_PHOTOS;
  const liveCode = codes.get(0) ?? null;
  const code = liveCode ?? [...codes.entries()].find(([id]) => shots.some((s) => s.id === id))?.[1] ?? null;

  function add(blobs: Blob[]) {
    const room = MAX_LABEL_PHOTOS - shots.length;
    if (blobs.length > room) toast(`Höchstens ${MAX_LABEL_PHOTOS} Fotos.`);
    const added = blobs.slice(0, Math.max(0, room)).map((blob) => ({ id: nextId.current++, blob }));
    setShots((s) => [...s, ...added]);
    for (const shot of added) {
      void detectBarcodeInImage(shot.blob).then((c) => c && setCodes((m) => new Map(m).set(shot.id, c)));
    }
  }

  async function shoot() {
    const blob = await capture.current?.();
    if (!blob) return toast.error('Die Kamera liefert noch kein Bild.');
    navigator.vibrate?.(30);
    add([blob]);
  }

  async function analyze() {
    if (busy || shots.length === 0) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const images = await Promise.all(shots.map((s) => compressImage(s.blob, LABEL_PIXELS, 0.85)));
      const label = await endpoints.readLabel(images, controller.signal);
      if (controller.signal.aborted) return;
      onResult(label, code);
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof OfflineError || e instanceof ApiError) toast.error(labelErrorMessage(e));
      else toast.error('Ein Foto konnte nicht gelesen werden. Versuche ein anderes Foto.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  function close() {
    request.current?.abort();
    request.current = null;
    onClose();
  }

  const strip = shots.length > 0 && (
    <ul className="absolute inset-x-5 bottom-24 z-10 flex gap-3" aria-label="Fotos">
      {shots.map((s, i) => (
        <Thumb
          key={s.id}
          shot={s}
          index={i}
          disabled={busy}
          onRemove={() => setShots((all) => all.filter((x) => x.id !== s.id))}
        />
      ))}
    </ul>
  );

  return (
    <FullscreenOverlay
      title="Etikett fotografieren"
      onClose={close}
      closeLabel={busy ? 'Abbrechen' : 'Schließen'}
      footer={
        <Button size="lg" disabled={busy || shots.length === 0} onClick={() => void analyze()}>
          {shots.length === 0
            ? 'Analysieren'
            : `Analysieren (${shots.length} ${shots.length === 1 ? 'Foto' : 'Fotos'})`}
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
          add([...(e.target.files ?? [])]);
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
          {busy && <AnalyzingOverlay title="Lese Etikett…" steps={LABEL_STEPS} />}
        </div>
      ) : (
        <BarcodeScanner
          frame="photo"
          onDetected={onDetected}
          onError={onError}
          paused={busy}
          captureRef={capture}
          onTorchState={setTorch}
        >
          {code && (
            <p className="absolute top-3 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 text-[0.8125rem] font-semibold whitespace-nowrap text-white">
              <Check className="size-4 text-good" strokeWidth={2.5} aria-hidden /> Barcode {code} erkannt
            </p>
          )}
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
              disabled={busy || full}
              onClick={() => void shoot()}
              className="grid size-[4.5rem] touch-manipulation place-items-center rounded-full border-4 border-white/90 bg-white/20 backdrop-blur-sm transition-transform active:scale-95 disabled:opacity-40 focus-visible:ring-[3px] focus-visible:ring-white/60 focus-visible:outline-none motion-reduce:transition-none"
            >
              <span className="size-14 rounded-full bg-white" aria-hidden />
            </button>
            {torch ? <TorchButton torch={torch} /> : <span className="size-11" aria-hidden />}
          </div>
          {busy && <AnalyzingOverlay title="Lese Etikett…" steps={LABEL_STEPS} />}
        </BarcodeScanner>
      )}
      <p className="mt-3 text-center text-sm text-muted-foreground">
        Nährwerttabelle, Name und Barcode, bis zu {MAX_LABEL_PHOTOS} Fotos
      </p>
    </FullscreenOverlay>
  );
}

function Thumb({
  shot,
  index,
  disabled,
  onRemove,
}: {
  shot: Shot;
  index: number;
  disabled: boolean;
  onRemove: () => void;
}) {
  const url = useObjectUrl(shot.blob, `label:${shot.id}`);
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
          className="absolute -top-2.5 -right-2.5 grid size-7 place-items-center rounded-full border-2 border-white bg-neutral-800 text-white focus-visible:ring-[3px] focus-visible:ring-white/60 focus-visible:outline-none"
        >
          <X className="size-3.5" strokeWidth={3} aria-hidden />
        </button>
      )}
    </li>
  );
}
