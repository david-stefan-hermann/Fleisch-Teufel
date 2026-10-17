import type { AiLabelResult } from '@ft/shared';
import { Check } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay';
import { detectBarcodeInImage } from '@/components/BarcodeScanner';
import { PhotoCaptureSheet, type CapturedShot } from '@/components/PhotoCaptureSheet';
import { compressImage, IMAGE_PRESETS } from '@/features/ai/image';
import { ApiError, endpoints, errorMessage, OfflineError } from '@/lib/api';

/** Front, nutrition table and barcode: all go to Claude in one call. */
export const MAX_LABEL_PHOTOS = 3;

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

/**
 * "Etikett fotografieren" above the custom food editor: live camera (or the photo library) for up
 * to three photos of one package (`PhotoCaptureSheet`), then one Claude call reads name, brand,
 * barcode and nutrients. The barcode is read locally first (live scanner and every photo, check
 * digit included) and shown as a chip; it wins over the model's reading. Nothing is stored: the
 * photos only live in memory while this layer is open. X during the analysis cancels it (the server
 * finishes the call, its answer is dropped).
 */
export function LabelCaptureSheet({
  onResult,
  onClose,
}: {
  onResult: (label: AiLabelResult, localBarcode: string | null) => void;
  onClose: () => void;
}) {
  const request = useRef<AbortController | null>(null);
  /** Valid codes seen by the live scanner or found in a photo (by shot id, 0 = live). */
  const [codes, setCodes] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const onLiveCode = useCallback(
    (code: string) => setCodes((m) => (m.get(0) === code ? m : new Map(m).set(0, code))),
    [],
  );
  const code = codes.get(0) ?? [...codes.entries()].find(([id]) => id !== 0)?.[1] ?? null;

  function added(shot: CapturedShot) {
    void detectBarcodeInImage(shot.blob).then((c) => c && setCodes((m) => new Map(m).set(shot.id, c)));
  }

  function removed(id: number) {
    setCodes((m) => {
      if (!m.has(id)) return m;
      const next = new Map(m);
      next.delete(id);
      return next;
    });
  }

  async function analyze(photos: Blob[]) {
    if (busy || photos.length === 0) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const images = await Promise.all(photos.map((p) => compressImage(p, IMAGE_PRESETS.label)));
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

  return (
    <PhotoCaptureSheet
      title="Etikett fotografieren"
      max={MAX_LABEL_PHOTOS}
      busy={busy}
      closeLabel={busy ? 'Abbrechen' : 'Schließen'}
      footerLabel={(n) => (n === 0 ? 'Analysieren' : `Analysieren (${n} ${n === 1 ? 'Foto' : 'Fotos'})`)}
      hint={`Nährwerttabelle, Name und Barcode, bis zu ${MAX_LABEL_PHOTOS} Fotos`}
      onSubmit={(photos) => void analyze(photos)}
      onClose={close}
      onAdded={added}
      onRemoved={removed}
      onLiveCode={onLiveCode}
      overlay={
        <>
          {code && (
            <p className="absolute top-3 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-3 text-[0.8125rem] font-semibold whitespace-nowrap text-white">
              <Check className="size-4 text-good" strokeWidth={2.5} aria-hidden /> Barcode {code} erkannt
            </p>
          )}
          {busy && <AnalyzingOverlay title="Lese Etikett…" steps={LABEL_STEPS} />}
        </>
      }
    />
  );
}
