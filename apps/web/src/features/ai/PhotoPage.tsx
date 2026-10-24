import {
  computeItem,
  get,
  MAX_ANALYSIS_PHOTOS,
  N,
  portionsFor,
  scaleNutrients,
  sumNutrients,
  targetsForDate,
  type AiAnalysisResult,
  type ResolvedTargets,
} from '@ft/shared';
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Camera,
  Check,
  Images,
  Keyboard,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
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
import { AmountEditor, type Amount } from '@/components/AmountEditor';
import { MealPhoto, PhotoCount } from '@/components/MealPhoto';
import { NameDialog } from '@/components/NameDialog';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { NutrientsDisclosure } from '@/components/NutrientsDisclosure';
import { PhotoCaptureSheet } from '@/components/PhotoCaptureSheet';
import { ScalePresets } from '@/components/ScalePresets';
import { PhotoStrip } from '@/components/PhotoStrip';
import { warmUpCamera } from '@/components/cameraWarmup';
import { EmptyState, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import {
  currentDraft,
  draftChanged,
  draftChoices,
  patchRow,
  rowGrams,
  scaleDraft,
  userRow,
  type RowGrams,
} from '@/db/aiDraft';
import type { AiDraft, AiDraftRow, AiQueueItem } from '@/db/dexie';
import { createAiMeal, logAiItems, logAiMeal } from '@/db/entries';
import { patchRecord } from '@/db/write';
import { getFood, recentAndFrequent, rememberFood, userPortions, type FoodUsage } from '@/foods/foodService';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useGoals, useSettings, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { basePortion, editorPortions, isBasePortion, SCALE_MAX, SCALE_MIN } from '@/lib/amounts';
import { endpoints, errorMessage } from '@/lib/api';
import { fmt0, fmtIngredients, fmtPercent, fmtTime } from '@/lib/format';
import { rememberIntoStart } from '@/lib/into';
import { cn } from '@/lib/utils';
import { FAT_OPTIONS, isFatFood, type FatOption } from './fatSuggestion';
import { compressImage, IMAGE_PRESETS } from './image';
import {
  addQueuePhotos,
  discardQueueItem,
  enqueueDescription,
  enqueuePhotos,
  leaveAnalysis,
  loadQueueImages,
  processQueue,
  reanalyze,
  removeQueuePhoto,
  restoreQueueItem,
  restoreQueuePhoto,
  retryQueueItem,
  takeQueueItem,
} from './queue';
import { useAiImages } from './useAiImage';

/** A photo in the preview; `id` keeps its identity while photos are added and removed. */
interface Shot {
  id: number;
  blob: Blob;
}

/** Hints people type most; a tap appends one to the hint field. */
const HINT_CHIPS = [
  'halbe Portion',
  'mit Öl gebraten',
  'ohne Öl',
  'ohne Soße',
  'Restaurantportion',
  'große Portion',
  'Light-Variante',
];

const addLabel = (n: number) => (n === 0 ? 'Hinzufügen' : `Hinzufügen (${n} ${n === 1 ? 'Foto' : 'Fotos'})`);

/**
 * "Essen eintragen": camera for barcodes and plate photos, the magnifier switches to the food search
 * for the same meal. Plate photos first show a preview with the optional hint, where more photos can
 * be added (further plates, courses, a label); only "Analysieren" sends them to Claude, in one call.
 * A finished analysis opens its review (`review` in the URL), but only while the person waits for it
 * here: leaving during the analysis (back arrow, swipe, another page) goes to the diary, and the
 * result is logged there by itself (`leaveAnalysis`).
 */
export function PhotoPage() {
  const { date, meal, review } = useSearch({ from: '/authed/photo' });
  const navigate = useNavigate({ from: '/photo' });
  const db = useDb();
  const settings = useSettings();
  const queue = useLiveQuery(() => db.aiQueue.orderBy('createdAt').reverse().toArray(), [db]);
  // The open analysis lives in the URL, so returning from the food search lands in it again.
  const setActiveId = (id: number | null) =>
    void navigate({ search: (s) => ({ ...s, review: id ?? undefined }), replace: id === null });
  const activeId = review ?? null;
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  // Photos waiting for "Analysieren" (preview), already compressed. Leaving the page drops them.
  const [shots, setShots] = useState<Shot[]>([]);
  const nextShot = useRef(1);
  const [analyzing, setAnalyzing] = useState(false);
  const [adding, setAdding] = useState(false);
  // "Beschreiben statt fotografieren": the camera makes way for a text field.
  const [describing, setDescribing] = useState(false);
  // The queue item the preview waits for, and whether the page was left meanwhile. Both are read
  // after awaits, where the component may be gone (state would be stale there).
  const waiting = useRef<number | null>(null);
  const gone = useRef(false);

  useEffect(() => {
    endpoints.aiStatus().then(
      (s) => setAiEnabled(s.enabled),
      () => setAiEnabled(null),
    );
    void processQueue(db);
  }, [db]);

  // Leaving the page while the analysis runs (swipe, browser back, a header link): it is logged by
  // itself. StrictMode runs this cleanup once on mount, when nothing waits yet.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const id = waiting.current;
      waiting.current = null;
      if (id !== null) void leaveAnalysis(db, id);
    };
  }, [db]);

  /** Back arrow during the analysis: straight to the diary, the result is logged there. */
  function leaveToDiary() {
    const id = waiting.current;
    waiting.current = null;
    if (id !== null) void leaveAnalysis(db, id);
    void navigate({ to: '/', search: { date }, replace: true });
  }

  /** Compresses taken or picked photos and adds them to the preview. */
  async function addShots(blobs: Blob[]) {
    setAdding(true);
    const added: Shot[] = [];
    for (const blob of blobs) {
      try {
        added.push({ id: nextShot.current++, blob: await compressImage(blob, IMAGE_PRESETS.analysis) });
      } catch {
        toast.error('Das Bild konnte nicht gelesen werden. Versuche ein anderes Foto.');
      }
    }
    setAdding(false);
    setShots((s) => [...s, ...added].slice(0, MAX_ANALYSIS_PHOTOS));
  }

  /** Queues the preview photos with the hint and waits for the result. */
  async function analyze(text: string) {
    if (analyzing || shots.length === 0) return;
    await follow(() =>
      enqueuePhotos(
        db,
        { date, meal, text },
        shots.map((s) => s.blob),
      ),
    );
  }

  /** "Beschreiben": queues the description (no photo) and waits for the result. */
  async function describeMeal(text: string) {
    if (analyzing || !text.trim()) return;
    await follow(() => enqueueDescription(db, { date, meal, text }));
  }

  /**
   * Queues an analysis and waits for it while the person stays here: a finished one opens its review,
   * an offline one goes to the diary as a placeholder, a failed one says so.
   */
  async function follow(enqueue: () => Promise<number>) {
    setAnalyzing(true);
    let id: number;
    try {
      id = await enqueue();
    } catch (e) {
      // Only storing can fail here; the analysis itself reports through the queue item.
      toast.error(errorMessage(e));
      setAnalyzing(false);
      return;
    }
    try {
      if (gone.current) return void leaveAnalysis(db, id);
      waiting.current = id;
      // The preview stays (with its overlay and the hint) while the analysis runs; `analyzing`
      // keeps its button inactive, so the photos cannot be queued a second time.
      await processQueue(db);
      // Left meanwhile (or handed over): never navigate from here any more.
      if (waiting.current !== id) return;
      const item = await db.aiQueue.get(id);
      // Left during the read: the result goes to the diary by itself.
      if (waiting.current !== id || gone.current) return void leaveAnalysis(db, id);
      waiting.current = null;
      // Stored and analysed: the preview is done, whatever the outcome.
      setShots([]);
      setDescribing(false);
      if (item?.status === 'done' && !item.deferred) return setActiveId(id);
      if (item?.status === 'pending') {
        // Offline: the photos are safe and already show in the diary; logged once analysed.
        toast(
          item?.textOnly
            ? 'Offline gespeichert. Die Beschreibung steht im Tagebuch und wird analysiert, sobald du wieder verbunden bist.'
            : 'Offline gespeichert. Das Foto steht im Tagebuch und wird analysiert, sobald du wieder verbunden bist.',
        );
        return void navigate({ to: '/', search: { date }, replace: true });
      }
      if (item?.status === 'failed') toast.error(item.error ?? 'Analyse fehlgeschlagen');
    } finally {
      setAnalyzing(false);
    }
  }

  const active = queue?.find((q) => q.localId === activeId);
  // The review stays while a re-analysis runs; a new key once it is done loads the new rows.
  if (active?.result) {
    const busy = active.status === 'pending' || active.status === 'analyzing';
    return (
      <ResultEditor
        key={`${active.localId}:${busy ? 'busy' : 'idle'}`}
        item={active}
        busy={busy}
        onClose={() => setActiveId(null)}
      />
    );
  }

  const mealName = settings?.mealNames[meal];
  const preview = shots.length > 0;
  const describe = describing && !preview;
  return (
    <Page
      title={
        <>
          Essen eintragen{' '}
          {mealName && <span className="text-sm font-normal text-muted-foreground">{mealName}</span>}
        </>
      }
      back
      // In the preview, back drops the photos and returns to the camera; during the analysis it
      // leaves for the diary; the describe form goes back to the camera.
      onBack={
        analyzing
          ? leaveToDiary
          : preview
            ? () => setShots([])
            : describe
              ? () => setDescribing(false)
              : undefined
      }
      withTabBar={false}
      actions={
        <>
          {/* A new page on purpose: back from the quick add returns here. */}
          <Button variant="ghost" size="icon" asChild>
            <Link to="/quick-add" search={{ date, meal }} aria-label="Schnelleingabe">
              <Zap aria-hidden />
            </Link>
          </Button>
          {!preview && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Beschreiben statt fotografieren"
              aria-pressed={describe}
              disabled={analyzing}
              onClick={() => setDescribing((d) => !d)}
            >
              <Keyboard aria-hidden />
            </Button>
          )}
          <Button variant="ghost" size="icon" asChild>
            {/* Replaces the page: switching between food page and search never piles up history. */}
            <Link to="/add" search={{ date, meal }} replace aria-label="Lebensmittel suchen">
              <Search aria-hidden />
            </Link>
          </Button>
        </>
      }
      footer={
        preview || describe ? (
          <Button
            size="lg"
            form={preview ? 'photo-preview' : 'describe-meal'}
            type="submit"
            disabled={analyzing || adding}
          >
            {analyzing ? (
              <>
                <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> Wird
                analysiert…
              </>
            ) : shots.length > 1 ? (
              `Analysieren (${shots.length} Fotos)`
            ) : (
              'Analysieren'
            )}
          </Button>
        ) : undefined
      }
    >
      {preview ? (
        <PhotoPreview
          shots={shots}
          busy={analyzing}
          adding={adding}
          onAdd={(blobs) => void addShots(blobs)}
          onRemove={(id) => setShots((s) => s.filter((x) => x.id !== id))}
          onAnalyze={(text) => void analyze(text)}
        />
      ) : describe ? (
        <DescribeForm busy={analyzing} onAnalyze={(text) => void describeMeal(text)} />
      ) : (
        <>
          {aiEnabled === false && (
            <p role="alert" className="mb-4 flex gap-2 rounded-xl bg-warn/10 p-3 text-sm">
              <TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />
              Die Foto-Analyse ist auf dem Server nicht eingerichtet (ANTHROPIC_API_KEY fehlt).
            </p>
          )}
          <CameraCapture
            busy={adding}
            onShots={(blobs) => void addShots(blobs)}
            onBarcode={(code) => void navigate({ to: '/scan', search: { date, meal, code }, replace: true })}
          />
          {queue && queue.length > 0 && (
            <Section title="Analysen" className="mt-4">
              <ul className="divide-y divide-border/70">
                {queue.map((q) => (
                  <QueueRow key={q.localId} item={q} onOpen={() => setActiveId(q.localId!)} />
                ))}
              </ul>
            </Section>
          )}
          <p className="mt-4 text-xs text-muted-foreground text-pretty">
            Barcodes im Bild werden sofort erkannt und nachgeschlagen. Teller-Fotos zeigen erst eine Vorschau,
            dort kannst du weitere Fotos hinzufügen (Dessert, Nährwerttabelle); mit „Analysieren“ gehen sie an
            Claude (Anthropic) und werden dort nicht gespeichert. Die Nährwerte stammen immer aus dem BLS bzw.
            Open Food Facts; die KI schätzt nur, was und wie viel auf dem Teller liegt (typisch ±20 bis
            40&nbsp;%). Prüfe die Mengen vor dem Eintragen.
          </p>
        </>
      )}
    </Page>
  );
}

/**
 * Taken or picked photos before they go to the AI: the photo strip (X removes one, the last X goes
 * back to the camera, "+" adds more through `PhotoCaptureSheet`) and the optional hint. "Analysieren"
 * (page footer, submits this form) queues and analyzes them.
 */
function PhotoPreview({
  shots,
  busy,
  adding,
  onAdd,
  onRemove,
  onAnalyze,
}: {
  shots: Shot[];
  /** Analysis running (state of the page: its footer button is disabled meanwhile). */
  busy: boolean;
  /** Photos being compressed. */
  adding: boolean;
  onAdd: (photos: Blob[]) => void;
  onRemove: (id: number) => void;
  onAnalyze: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(false);
  const room = MAX_ANALYSIS_PHOTOS - shots.length;

  return (
    <form
      id="photo-preview"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAnalyze(text);
      }}
    >
      <PhotoStrip
        photos={shots.map((s) => ({ key: `shot:${s.id}`, blob: s.blob, removable: true }))}
        alt={shots.length > 1 ? 'Gewähltes Foto' : 'Aufgenommenes Foto'}
        max={MAX_ANALYSIS_PHOTOS}
        busy={busy || adding}
        addLabel="Fotos hinzufügen"
        onAdd={() => {
          warmUpCamera();
          setSheet(true);
        }}
        onRemove={(key) => onRemove(Number(key.slice('shot:'.length)))}
      >
        {busy && <AnalyzingOverlay />}
      </PhotoStrip>
      <div className="grid gap-1.5">
        <Label htmlFor="ai-text">Hinweis für die Analyse (optional)</Label>
        <Input
          id="ai-text"
          value={text}
          disabled={busy}
          maxLength={500}
          enterKeyHint="go"
          onChange={(e) => setText(e.target.value)}
          placeholder="z. B. „mit Butter gebraten“, „halbe Portion“, „250 g Hähnchen“…"
          aria-describedby="ai-text-hint"
        />
        {!busy && (
          <div className="flex flex-wrap gap-2" aria-label="Häufige Hinweise">
            {HINT_CHIPS.map((chip) => (
              <Button
                key={chip}
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 rounded-full"
                onClick={() => setText((t) => (t.trim() ? `${t.trim()}, ${chip}` : chip).slice(0, 500))}
              >
                {chip}
              </Button>
            ))}
          </div>
        )}
        <p id="ai-text-hint" className="text-xs text-muted-foreground">
          {busy
            ? 'Du kannst zurück ins Tagebuch gehen. Das Ergebnis wird dort eingetragen.'
            : 'Erst mit „Analysieren“ gehen die Fotos an Claude. Mit + kommen weitere Teller, Gänge oder die Nährwerttabelle dazu.'}
        </p>
      </div>
      {sheet && (
        <PhotoCaptureSheet
          title="Fotos hinzufügen"
          max={room}
          preset={IMAGE_PRESETS.analysis}
          footerLabel={addLabel}
          hint={`Weitere Teller, Gänge oder die Nährwerttabelle, bis zu ${MAX_ANALYSIS_PHOTOS} Fotos insgesamt`}
          onSubmit={(photos) => {
            setSheet(false);
            onAdd(photos);
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </form>
  );
}

/**
 * "Beschreiben statt fotografieren": the meal in words (restaurant, canteen, logging later), analysed
 * with the same call as a photo and reviewed the same way. The camera is off meanwhile.
 */
function DescribeForm({ busy, onAnalyze }: { busy: boolean; onAnalyze: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      id="describe-meal"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onAnalyze(text);
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="describe-text">Was hast du gegessen?</Label>
        <Textarea
          id="describe-text"
          value={text}
          disabled={busy}
          maxLength={1000}
          rows={4}
          autoFocus
          enterKeyHint="done"
          onChange={(e) => setText(e.target.value)}
          placeholder="z. B. „Döner mit allem, kleine Pommes, Cola 0,33 l“ oder „2 Scheiben Vollkornbrot mit Butter und Gouda, ein Apfel“"
          aria-describedby="describe-hint"
        />
        <p id="describe-hint" className="text-xs text-muted-foreground text-pretty">
          {busy
            ? 'Du kannst zurück ins Tagebuch gehen. Das Ergebnis wird dort eingetragen.'
            : 'Mengen helfen („200 g“, „halbe Portion“, „Restaurantportion“); ohne Angabe nimmt die KI übliche Portionen. Danach prüfst du die Zutaten wie bei einem Foto.'}
        </p>
      </div>
      {busy && (
        <div className="relative h-28 overflow-hidden rounded-2xl border border-border/70 bg-muted">
          <AnalyzingOverlay
            title="Analysiere Beschreibung…"
            steps={['Lese die Beschreibung', 'Suche die Lebensmittel', 'Schätze die Mengen']}
          />
        </div>
      )}
    </form>
  );
}

/**
 * Live camera as the single entry point: a barcode in view is looked up immediately, the shutter
 * takes the frame for the preview, the gallery button (bottom left) picks a saved photo (one with a
 * barcode goes straight to the product lookup), the torch toggle sits bottom right when the camera
 * has one.
 *
 * iOS limit: a file input without `capture` always opens the action sheet (photo library / take
 * photo / choose file); no web API opens the photo library directly.
 */
function CameraCapture({
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

function QueueRow({ item, onOpen }: { item: AiQueueItem; onOpen: () => void }) {
  const db = useDb();
  const photos = useAiImages(item);
  const first = photos?.[0];
  const label =
    item.status === 'pending'
      ? 'Wartet auf Verbindung'
      : item.status === 'analyzing'
        ? 'Wird analysiert…'
        : item.result
          ? `${item.result.items.length} Lebensmittel erkannt, bitte prüfen`
          : (item.error ?? 'Fehlgeschlagen');
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <div className="relative size-12 shrink-0">
        <MealPhoto
          blob={first?.blob ?? null}
          blobKey={`aiPhoto:${item.localId}:${first?.id}`}
          alt=""
          className="size-12 rounded-lg"
        />
        <PhotoCount count={photos?.length ?? 0} />
        {item.status === 'analyzing' && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 text-white">
            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          </div>
        )}
      </div>
      <button
        type="button"
        className="min-w-0 flex-1 text-left disabled:cursor-default"
        disabled={!item.result}
        onClick={onOpen}
      >
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {fmtTime(item.createdAt)}
          {item.text ? ` · ${item.text}` : ''}
        </div>
      </button>
      {item.status === 'failed' && !item.result && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Wiederholen"
          onClick={() => void retryQueueItem(db, item.localId!)}
        >
          <RotateCcw aria-hidden />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Verwerfen"
        onClick={() =>
          // A paid result and its photos: gone only once the undo toast has passed.
          void takeQueueItem(db, item.localId!).then((taken) => {
            if (!taken) return;
            toast(`${label} verworfen`, {
              action: { label: 'Rückgängig', onClick: () => void restoreQueueItem(db, taken) },
            });
          })
        }
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

const CONFIDENCE = { low: 'unsicher', medium: 'mittel', high: 'sicher' } as const;

/** Review content while a re-analysis runs: greyed out and not interactive. */
const BUSY = 'pointer-events-none opacity-45 saturate-50 select-none';

/**
 * Review of a finished analysis. The working state is kept in component state for smooth typing and
 * written through to the queue item (`draft`), so adding an ingredient via the food search (or
 * closing the app) does not lose any edits. The hint stays editable; ↻ sends the photo again with it
 * (asking first when the ingredients were changed). While that runs (`busy`) the review is greyed
 * out under the analysis overlay; X still leaves.
 */
function ResultEditor({ item, busy, onClose }: { item: AiQueueItem; busy: boolean; onClose: () => void }) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const settings = useSettings();
  const goals = useGoals();
  const result = item.result as AiAnalysisResult;
  const photos = useAiImages(item);
  // Photos added after the analysis ("Neu") or removed since: only ↻ takes them into account. Items of
  // older app versions have no record, then nothing counts as changed.
  const analyzed = item.analyzedPhotoIds;
  const photoIds = (photos ?? []).map((p) => p.id);
  const fresh = analyzed ? photoIds.filter((id) => !analyzed.includes(id)) : [];
  const dropped = analyzed ? analyzed.filter((id) => !photoIds.includes(id)) : [];
  const photosChanged = photos !== undefined && (fresh.length > 0 || dropped.length > 0);
  const [sheet, setSheet] = useState(false);
  const [draft, setDraft] = useState<AiDraft>(() => currentDraft(item));
  const { rows, meal, mealName } = draft;
  const commit = (next: AiDraft) => {
    setDraft(next);
    void db.aiQueue.update(item.localId!, { draft: next });
  };
  // "Gesamtmenge": factor applied to the grams of the last manual change (`scaleBase`). Not persisted:
  // after a reload the grams are what was saved and the slider starts at 100 % again.
  const [scale, setScale] = useState(1);
  const [scaleBase, setScaleBase] = useState<RowGrams>(() => rowGrams(draft));
  /** Commits a manual change of the rows; it becomes the new reference of the scale slider. */
  const commitRows = (next: AiDraft) => {
    commit(next);
    setScale(1);
    setScaleBase(rowGrams(next));
  };
  const update = (key: string, patch: Partial<AiDraftRow>) => commitRows(patchRow(draft, key, patch));
  /** Live change while a wheel turns: only the screen follows, saved when it stops. */
  const preview = (key: string, patch: Partial<AiDraftRow>) => setDraft(patchRow(draft, key, patch));
  const rescale = (factor: number) => {
    setScale(factor);
    setDraft(scaleDraft(draft, scaleBase, factor));
  };

  const resolved = rows
    .map((r) => {
      const food = r.candidates.find((c) => c.id === r.foodId);
      if (!food || !r.grams || r.grams <= 0) return null;
      return {
        row: r,
        food,
        portion: r.portion ?? null,
        ...computeItem({ per100: food.nutrients, portionLabel: '1 g', portionGrams: 1, quantity: r.grams }),
      };
    })
    .filter((x) => x !== null);
  const totals = sumNutrients(resolved.map((r) => r.nutrients));
  const targets = targetsForDate(goals ?? [], item.date);
  // "N× gegessen" next to the candidates: a food logged before is the safer pick.
  const today = useToday();
  const usage = useLiveQuery(async () => (await recentAndFrequent(db, today)).usage, [db, today]);
  // Fat is what photo estimates miss most: offer oil and butter while no ingredient is a fat.
  const fatMissing = resolved.length > 0 && !resolved.some((r) => isFatFood(r.food));

  async function addFat(opt: FatOption) {
    const food = await getFood(db, opt.foodId);
    if (!food) return void toast.error('Das Lebensmittel ist auf diesem Gerät nicht verfügbar.');
    commitRows({ ...draft, rows: [...rows, userRow(opt.name, food, opt.grams)] });
  }

  /** Opens the food search: for a row ("Selbst suchen", its food gets replaced) or for a new ingredient. */
  async function searchIngredient(row?: AiDraftRow) {
    const q = row?.name;
    const next = { ...draft, searchRowKey: row?.key ?? null };
    setDraft(next);
    await db.aiQueue.update(item.localId!, { draft: next });
    rememberIntoStart(router.history);
    void navigate({
      to: '/add',
      search: { date: item.date, meal, into: `ai:${item.localId}`, ...(q ? { q } : {}) },
    });
  }

  const savedMealId = draft.savedMealId ?? null;
  const name = mealName.trim() || 'Foto-Meal';
  const [saveOpen, setSaveOpen] = useState(false);
  const [hint, setHint] = useState(item.text);
  const [askRedo, setAskRedo] = useState(false);
  const { busy: logging, run } = useSubmitting();

  async function redo() {
    setAskRedo(false);
    const status = await reanalyze(db, item.localId!, hint);
    if (status === 'pending') toast('Offline. Das Foto wird analysiert, sobald du wieder verbunden bist.');
    else if (status === 'failed') {
      const now = await db.aiQueue.get(item.localId!);
      toast.error(now?.error ?? 'Analyse fehlgeschlagen');
    }
  }

  /** "Als Meal speichern": creates the meal with the photo (logs nothing), or renames it later. */
  async function saveAsMeal(newName: string) {
    let id = savedMealId;
    if (id) await patchRecord(db, 'meals', id, { name: newName });
    else {
      const items = resolved.map((r) => ({ food: r.food, grams: r.grams, portion: r.portion }));
      id = await createAiMeal(db, newName, items, (await loadQueueImages(db, item))[0] ?? null);
    }
    commit({ ...draft, mealName: newName, savedMealId: id });
    toast.success(`„${newName}“ gespeichert`);
  }

  /**
   * "Meal eintragen": attached to the saved meal (which takes over the current ingredients) when
   * the review was saved, otherwise as one named group without a meal. Both keep the photo.
   */
  async function log() {
    const items = resolved.map((r) => ({ food: r.food, grams: r.grams, portion: r.portion }));
    const target = { date: item.date, meal };
    // Read before `discardQueueItem` drops the queue photos.
    const images = await loadQueueImages(db, item);
    if (savedMealId) await logAiMeal(db, savedMealId, name, items, target, result, images);
    else await logAiItems(db, name, items, target, result, images);
    for (const r of resolved) await rememberFood(db, r.food);
    // Not awaited and allowed to fail (offline): the next analysis just does not know the choice.
    const choices = draftChoices(item, draft);
    if (choices.length > 0) void endpoints.aiChoices(result.analysisId, choices).catch(() => {});
    await discardQueueItem(db, item.localId!);
    if (savedMealId)
      toast.success(`„${name}“ eingetragen`, {
        description: 'Unter „Gespeicherte Meals“ kannst du es jederzeit wieder eintragen und bearbeiten.',
      });
    else toast.success(`„${name}“ eingetragen`);
    // Replace: "back" from the diary must not reopen the review of a logged analysis.
    await navigate({ to: '/', search: { date: item.date }, replace: true });
  }

  return (
    <Page
      title="Ergebnis prüfen"
      back
      withTabBar={false}
      footer={
        <Button
          size="lg"
          disabled={busy || logging || resolved.length === 0}
          className={cn(busy && 'saturate-50')}
          onClick={() => void run(log)}
        >
          Meal eintragen
        </Button>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Neu analysieren"
            disabled={busy}
            onClick={() => (draftChanged({ ...item, draft }) ? setAskRedo(true) : void redo())}
          >
            <RotateCcw aria-hidden />
          </Button>
          {savedMealId ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setSaveOpen(true)}
              aria-label={`Als Meal „${name}“ gespeichert, Namen ändern`}
              className="flex h-8 items-center gap-1 rounded-full bg-good/10 px-2.5 text-sm font-medium text-good-text focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-40"
            >
              <Check className="size-4" aria-hidden /> Gespeichert
            </button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Als Meal speichern"
              disabled={busy || resolved.length === 0}
              onClick={() => setSaveOpen(true)}
            >
              <Save aria-hidden />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zurück zur Liste">
            <X aria-hidden />
          </Button>
        </>
      }
    >
      <div className="mb-4 grid gap-1.5">
        <PhotoStrip
          photos={(photos ?? []).map((p) => ({
            key: `aiPhoto:${item.localId}:${p.id}`,
            blob: p.blob,
            ...(fresh.includes(p.id) ? { badge: 'Neu' } : {}),
            // The last photo stays; a not yet migrated one (id 0) has no row to remove.
            removable: photos!.length > 1 && p.id !== 0,
          }))}
          alt="Analysiertes Foto"
          max={MAX_ANALYSIS_PHOTOS}
          busy={busy}
          addLabel="Fotos hinzufügen"
          onAdd={() => {
            warmUpCamera();
            setSheet(true);
          }}
          onRemove={(key) =>
            void removeQueuePhoto(db, Number(key.slice(key.lastIndexOf(':') + 1))).then((row) => {
              if (!row) return;
              toast('Foto entfernt', {
                action: { label: 'Rückgängig', onClick: () => void restoreQueuePhoto(db, row) },
              });
            })
          }
        >
          {busy && <AnalyzingOverlay />}
        </PhotoStrip>
        {photosChanged && !busy && (
          <p className="text-sm text-muted-foreground text-pretty">
            {fresh.length === 0
              ? 'Fotos geändert. Tippe oben auf ↻, um neu zu analysieren.'
              : `${fresh.length === 1 ? '1 Foto' : `${fresh.length} Fotos`} noch nicht analysiert. Tippe oben auf ↻, um neu zu analysieren.`}
          </p>
        )}
      </div>
      {sheet && (
        <PhotoCaptureSheet
          title="Fotos hinzufügen"
          max={MAX_ANALYSIS_PHOTOS - photoIds.length}
          preset={IMAGE_PRESETS.analysis}
          footerLabel={addLabel}
          hint={`Weitere Teller, Gänge oder die Nährwerttabelle, bis zu ${MAX_ANALYSIS_PHOTOS} Fotos insgesamt`}
          onSubmit={(blobs) => {
            setSheet(false);
            void addQueuePhotos(db, item.localId!, blobs);
          }}
          onClose={() => setSheet(false)}
        />
      )}
      <div className={cn('grid', busy && BUSY)} aria-busy={busy || undefined}>
        {result.notes && <p className="mb-4 rounded-xl bg-muted p-3 text-sm text-pretty">{result.notes}</p>}
        {rows.length === 0 && (
          <EmptyState title="Kein Essen erkannt">
            Versuche ein Foto von schräg oben bei gutem Licht oder füge die Zutaten selbst hinzu.
          </EmptyState>
        )}
        <div className="mb-4 grid gap-1.5">
          <Label htmlFor="review-hint">
            {item.textOnly ? 'Beschreibung der Mahlzeit' : 'Hinweis für die Analyse'}
          </Label>
          <Input
            id="review-hint"
            value={hint}
            disabled={busy}
            maxLength={500}
            enterKeyHint="done"
            onChange={(e) => {
              setHint(e.target.value);
              void db.aiQueue.update(item.localId!, { text: e.target.value });
            }}
            placeholder="z. B. „mit Butter gebraten“, „halbe Portion“, „250 g Hähnchen“…"
            aria-describedby="review-hint-help"
          />
          <p id="review-hint-help" className="text-xs text-muted-foreground">
            Ändern und oben auf ↻ tippen, um neu zu analysieren.
          </p>
        </div>
        {rows.map((r) => (
          <ReviewRow
            key={r.key}
            row={r}
            targets={targets}
            usage={usage}
            onPreview={(patch) => preview(r.key, patch)}
            onChange={(patch) => update(r.key, patch)}
            onRemove={() => commitRows({ ...draft, rows: rows.filter((x) => x.key !== r.key) })}
            onSearch={() => void searchIngredient(r)}
          />
        ))}
        {fatMissing && (
          <div
            className="mb-3 flex flex-wrap items-center gap-2 px-1 text-sm text-muted-foreground"
            role="group"
            aria-label="Bratfett ergänzen"
          >
            <span>Kein Bratfett dabei?</span>
            {FAT_OPTIONS.map((opt) => (
              <Button
                key={opt.foodId}
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 rounded-full"
                onClick={() => void addFat(opt)}
              >
                <Plus aria-hidden /> {opt.label}
              </Button>
            ))}
          </div>
        )}
        <Button variant="outline" className="mb-4 w-full" onClick={() => void searchIngredient()}>
          <Plus aria-hidden /> Zutat hinzufügen
        </Button>

        <Section>
          <div className="grid gap-3 p-4">
            {rows.some((r) => (scaleBase[r.key] ?? 0) > 0) && (
              <div className="grid gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <Label htmlFor="result-scale">Gesamtmenge</Label>
                    <p id="result-scale-hint" className="text-xs text-muted-foreground">
                      Skaliert alle Zutaten
                    </p>
                  </div>
                  <output htmlFor="result-scale" className="tabular text-lg font-semibold">
                    {fmtPercent(scale)}
                  </output>
                </div>
                <Slider
                  id="result-scale"
                  aria-label="Gesamtmenge skalieren"
                  aria-describedby="result-scale-hint"
                  aria-valuetext={fmtPercent(scale)}
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step={0.05}
                  value={[scale]}
                  onValueChange={([v]) => v !== undefined && rescale(v)}
                  // From the commit value, not the draft of this render (keyboard steps change and commit at once).
                  onValueCommit={([v]) => commit(scaleDraft(draft, scaleBase, v ?? scale))}
                />
                <ScalePresets
                  value={scale}
                  onPick={(f) => {
                    setScale(f);
                    commit(scaleDraft(draft, scaleBase, f));
                  }}
                />
              </div>
            )}
            <NutrientBreakdown title="Summe" nutrients={totals} targets={targets} />
            <div className="grid gap-1.5">
              <Label htmlFor="result-meal">Mahlzeit</Label>
              <Select value={String(meal)} onValueChange={(v) => commit({ ...draft, meal: Number(v) })}>
                <SelectTrigger id="result-meal" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(settings?.mealNames ?? []).map((n, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground text-pretty">
              {savedMealId
                ? `Als Meal „${name}“ gespeichert (mit Foto). „Meal eintragen“ hängt es an dieses Meal, so erscheint es im Tagebuch mit Foto.`
                : `${fmtIngredients(resolved.length)} werden als Gruppe „${name}“ eingetragen. Mit dem Speichern-Icon oben legst du sie zusätzlich mit Foto unter „Gespeicherte Meals“ ab.`}
            </p>
            <p className="text-xs text-muted-foreground">
              Modell {result.model} · {result.usage.inputTokens + result.usage.outputTokens} Tokens · ≈{' '}
              {result.usage.costUsd.toLocaleString('de-DE', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 3,
              })}
            </p>
          </div>
        </Section>
      </div>
      <Dialog open={askRedo} onOpenChange={setAskRedo}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Neu analysieren?</DialogTitle>
            <DialogDescription>Deine Änderungen an den Zutaten gehen verloren.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskRedo(false)}>
              Abbrechen
            </Button>
            <Button onClick={() => void redo()}>Neu analysieren</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Als Meal speichern"
        description={`${fmtIngredients(resolved.length)} werden mit dem Foto als wiederverwendbares Meal gespeichert. Eingetragen wird erst mit „Meal eintragen“.`}
        confirmLabel="Meal speichern"
        defaultName={name}
        placeholder="z. B. Spaghetti Bolognese…"
        onConfirm={saveAsMeal}
      />
    </Page>
  );
}

/**
 * One ingredient of the review: name, confidence, kcal and remove in the head, the database choice,
 * then the amount editor (grams or a portion of the food). Slider ticks only preview (`onPreview`);
 * letting go, typing and choosing save.
 */
function ReviewRow({
  row: r,
  targets,
  usage,
  onPreview,
  onChange,
  onRemove,
  onSearch,
}: {
  row: AiDraftRow;
  targets: ResolvedTargets;
  /** How often each food was logged (candidates say "3× gegessen"). */
  usage: FoodUsage | undefined;
  onPreview: (patch: Partial<AiDraftRow>) => void;
  onChange: (patch: Partial<AiDraftRow>) => void;
  onRemove: () => void;
  onSearch: () => void;
}) {
  const food = r.candidates.find((c) => c.id === r.foodId);
  const kcal = food && r.grams ? (get(food.nutrients, N.kcal) * r.grams) / 100 : 0;
  const db = useDb();
  const own = useLiveQuery(async () => (food ? userPortions(db, food.id) : []), [db, food?.id]);
  const unit = food?.unit ?? 'g';
  const base = basePortion(unit);
  const portion = r.portion && r.portion.grams > 0 ? r.portion : base;
  const amount: Amount = {
    portion,
    quantity: r.grams === null ? null : Math.round((r.grams / portion.grams) * 100) / 100,
  };
  const portions = editorPortions(unit, food ? portionsFor(food, own ?? []) : [], portion);
  /** Grams stay the amount of the row; the unit only changes how it is set. */
  const rowAmount = (a: Amount): Partial<AiDraftRow> => ({
    portion: isBasePortion(a.portion) ? null : a.portion,
    grams: a.quantity === null ? null : Math.round(a.quantity * a.portion.grams * 100) / 100,
  });
  const eaten = (id: string) => {
    const n = usage?.get(id)?.count ?? 0;
    return n > 0 ? ` · ${fmt0(n)}× gegessen` : '';
  };
  return (
    <Section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold break-words">{r.name}</div>
            {r.confidence ? (
              <Badge variant={r.confidence === 'low' ? 'outline' : 'secondary'} className="mt-1">
                KI: {CONFIDENCE[r.confidence]}
              </Badge>
            ) : (
              <Badge variant="secondary" className="mt-1">
                von dir hinzugefügt
              </Badge>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="tabular font-semibold">{fmt0(kcal)} kcal</span>
            <Button variant="ghost" size="icon" aria-label={`${r.name} entfernen`} onClick={onRemove}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>
        {r.candidates.length > 1 ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`cand-${r.key}`}>Lebensmittel aus der Datenbank</Label>
            {/* Another food may not have the chosen portion: back to grams, same amount. */}
            <Select value={r.foodId ?? ''} onValueChange={(v) => onChange({ foodId: v, portion: null })}>
              <SelectTrigger
                id={`cand-${r.key}`}
                className="h-auto min-h-11 w-full py-2 text-left whitespace-normal"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {r.candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.brand ? ` (${c.brand})` : ''} · {fmt0(get(c.nutrients, N.kcal))} kcal/100 g
                    {eaten(c.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : food?.estimated ? (
          <p className="text-sm text-muted-foreground">
            Nicht in der Datenbank: Nährwerte von der KI geschätzt ({fmt0(get(food.nutrients, N.kcal))}{' '}
            kcal/100 g).{' '}
            <button type="button" onClick={onSearch} className="text-primary underline">
              Selbst suchen
            </button>
          </p>
        ) : r.candidates.length === 1 ? (
          <p className="text-sm text-muted-foreground">
            {r.candidates[0]!.name}
            {r.candidates[0]!.brand ? ` (${r.candidates[0]!.brand})` : ''} ·{' '}
            {fmt0(get(r.candidates[0]!.nutrients, N.kcal))} kcal/100 g{eaten(r.candidates[0]!.id)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Kein passendes Lebensmittel gefunden, wird nicht eingetragen.{' '}
            <button type="button" onClick={onSearch} className="text-primary underline">
              Selbst suchen
            </button>
          </p>
        )}
        <AmountEditor
          name={r.name}
          unit={unit}
          portions={portions}
          value={amount}
          onChange={(a) => onPreview(rowAmount(a))}
          onCommit={(a) => onChange(rowAmount(a))}
        />
        {food && r.grams ? (
          <NutrientsDisclosure
            title={entryAmountLabel({
              source: 'ai',
              grams: r.grams,
              portionLabel: amount.portion.label,
              portionGrams: amount.portion.grams,
              quantity: amount.quantity ?? 0,
            })}
            nutrients={scaleNutrients(food.nutrients, r.grams)}
            targets={targets}
          />
        ) : null}
      </div>
    </Section>
  );
}
