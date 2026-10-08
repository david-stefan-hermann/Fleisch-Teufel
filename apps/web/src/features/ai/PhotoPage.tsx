import {
  computeItem,
  get,
  N,
  scaleNutrients,
  sumNutrients,
  targetsForDate,
  type AiAnalysisResult,
} from '@ft/shared';
import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Camera,
  Check,
  Images,
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
import { MealPhoto, useObjectUrl } from '@/components/MealPhoto';
import { NameDialog } from '@/components/NameDialog';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { NutrientsDisclosure } from '@/components/NutrientsDisclosure';
import { NumberField } from '@/components/NumberField';
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
import { currentDraft, draftChanged, patchRow, rowGrams, scaleDraft, type RowGrams } from '@/db/aiDraft';
import type { AiDraft, AiDraftRow, AiQueueItem } from '@/db/dexie';
import { createAiMeal, logAiItems, logAiMeal } from '@/db/entries';
import { patchRecord } from '@/db/write';
import { rememberFood } from '@/foods/foodService';
import { useGoals, useSettings } from '@/hooks/data';
import { rowSliderMax } from '@/lib/amounts';
import { endpoints } from '@/lib/api';
import { fmt0, fmtGrams, fmtIngredients, fmtPercent, fmtTime } from '@/lib/format';
import { rememberIntoStart } from '@/lib/into';
import { cn } from '@/lib/utils';
import { compressImage } from './image';
import { discardQueueItem, enqueuePhoto, imageBlob, processQueue, reanalyze } from './queue';

/**
 * "Essen eintragen": camera for barcodes and plate photos, the magnifier switches to the food search
 * for the same meal. A plate photo first shows a preview with the optional hint; only "Analysieren"
 * sends it to Claude. A finished analysis opens its review (`review` in the URL).
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
  // Photo waiting for "Analysieren" (preview). Leaving the page drops it.
  const [shot, setShot] = useState<Blob | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    endpoints.aiStatus().then(
      (s) => setAiEnabled(s.enabled),
      () => setAiEnabled(null),
    );
    void processQueue(db);
  }, [db]);

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
  return (
    <Page
      title={
        <>
          Essen eintragen{' '}
          {mealName && <span className="text-sm font-normal text-muted-foreground">{mealName}</span>}
        </>
      }
      back
      // In the preview, back discards the photo and returns to the camera.
      onBack={shot ? () => setShot(null) : undefined}
      withTabBar={false}
      actions={
        <>
          {/* A new page on purpose: back from the quick add returns here. */}
          <Button variant="ghost" size="icon" asChild>
            <Link to="/quick-add" search={{ date, meal }} aria-label="Schnelleingabe">
              <Zap aria-hidden />
            </Link>
          </Button>
          <Button variant="ghost" size="icon" asChild>
            {/* Replaces the page: switching between food page and search never piles up history. */}
            <Link to="/add" search={{ date, meal }} replace aria-label="Lebensmittel suchen">
              <Search aria-hidden />
            </Link>
          </Button>
        </>
      }
      footer={
        shot ? (
          <Button size="lg" form="photo-preview" type="submit" disabled={analyzing}>
            Analysieren
          </Button>
        ) : undefined
      }
    >
      {shot ? (
        <PhotoPreview
          shot={shot}
          busy={analyzing}
          onBusyChange={setAnalyzing}
          date={date}
          meal={meal}
          onDiscard={() => setShot(null)}
          onQueued={(id) => {
            setShot(null);
            setActiveId(id);
          }}
        />
      ) : (
        <>
          {aiEnabled === false && (
            <p role="alert" className="mb-4 flex gap-2 rounded-xl bg-warn/10 p-3 text-sm">
              <TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />
              Die Foto-Analyse ist auf dem Server nicht eingerichtet (ANTHROPIC_API_KEY fehlt).
            </p>
          )}
          <CameraCapture
            onShot={setShot}
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
            Barcodes im Bild werden sofort erkannt und nachgeschlagen. Teller-Fotos zeigen erst eine Vorschau;
            mit „Analysieren“ gehen sie an Claude (Anthropic) und werden dort nicht gespeichert. Die Nährwerte
            stammen immer aus dem BLS bzw. Open Food Facts; die KI schätzt nur, was und wie viel auf dem
            Teller liegt (typisch ±20 bis 40&nbsp;%). Prüfe die Mengen vor dem Eintragen.
          </p>
        </>
      )}
    </Page>
  );
}

/**
 * A taken or picked photo before it goes to the AI: the optional hint can be added, "Analysieren"
 * (page footer, submits this form) queues and analyzes it, "Neu aufnehmen" drops it.
 */
function PhotoPreview({
  shot,
  busy,
  onBusyChange: setBusy,
  date,
  meal,
  onDiscard,
  onQueued,
}: {
  shot: Blob;
  /** Analysis running (state of the page: its footer button is disabled meanwhile). */
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  date: string;
  meal: number;
  onDiscard: () => void;
  onQueued: (id: number) => void;
}) {
  const db = useDb();
  const url = useObjectUrl(shot);
  const [text, setText] = useState('');

  async function analyze() {
    if (busy) return;
    setBusy(true);
    try {
      const compressed = await compressImage(shot);
      const id = await enqueuePhoto(db, { date, meal, text }, compressed);
      await processQueue(db);
      const item = await db.aiQueue.get(id);
      if (item?.status === 'done') return onQueued(id);
      if (item?.status === 'pending')
        toast('Offline. Das Foto wird analysiert, sobald du wieder verbunden bist.');
      else if (item?.status === 'failed') toast.error(item.error ?? 'Analyse fehlgeschlagen');
      onDiscard();
    } catch {
      toast.error('Das Bild konnte nicht gelesen werden. Versuche ein anderes Foto.');
      onDiscard();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="photo-preview"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void analyze();
      }}
    >
      <div className="relative overflow-hidden rounded-2xl bg-black">
        {url && <img src={url} alt="Aufgenommenes Foto" className="aspect-[3/4] w-full object-cover" />}
        <Button
          type="button"
          variant="secondary"
          className="absolute top-3 left-3 rounded-xl bg-black/55 text-white hover:bg-black/70"
          disabled={busy}
          onClick={onDiscard}
        >
          <RotateCcw aria-hidden /> Neu aufnehmen
        </Button>
        {busy && <AnalyzingOverlay />}
      </div>
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
        <p id="ai-text-hint" className="text-xs text-muted-foreground">
          Erst mit „Analysieren“ geht das Foto an Claude.
        </p>
      </div>
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
  onShot,
  onBarcode,
}: {
  onShot: (photo: Blob) => void;
  onBarcode: (code: string) => void;
}) {
  const galleryInput = useRef<HTMLInputElement>(null);
  const fallbackCamera = useRef<HTMLInputElement>(null);
  const capture = useRef<CaptureFn | null>(null);
  const [camError, setCamError] = useState<ScannerError | null>(null);
  const [torch, setTorch] = useState<TorchState>(null);
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
    onShot(blob);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    // A photographed barcode skips the AI entirely and goes to the product lookup.
    const code = await detectBarcodeInImage(file);
    setBusy(false);
    if (code) return onDetected(code);
    onShot(file);
  }

  const overlay = (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-4">
      <Button
        variant="secondary"
        size="icon-lg"
        className="rounded-xl bg-black/55 text-white hover:bg-black/70"
        aria-label="Aus der Mediathek wählen"
        disabled={busy}
        onClick={() => galleryInput.current?.click()}
      >
        <Images className="size-6" aria-hidden />
      </Button>
      <button
        type="button"
        aria-label="Foto aufnehmen"
        disabled={busy}
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
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void pick(e.target.files?.[0]);
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
            onChange={(e) => void pick(e.target.files?.[0])}
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
        >
          {overlay}
        </BarcodeScanner>
      )}
    </div>
  );
}

/**
 * Photo of a queue item: the `aiImages` row (re-read only when that row changes, not on every
 * status change of the item), or the inline Blob of an item from an older app version.
 * `undefined` while loading, `null` when there is none.
 */
function useAiImage(item: AiQueueItem): Blob | null | undefined {
  const db = useDb();
  const legacy = item.image ?? null;
  return useLiveQuery(async () => {
    const row = item.localId !== undefined ? await db.aiImages.get(item.localId) : undefined;
    return row ? imageBlob(row) : legacy;
  }, [db, item.localId, legacy]);
}

function QueueRow({ item, onOpen }: { item: AiQueueItem; onOpen: () => void }) {
  const db = useDb();
  const image = useAiImage(item);
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
        <MealPhoto blob={image} blobKey={`ai:${item.localId}`} alt="" className="size-12 rounded-lg" />
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
        <div className="text-xs text-muted-foreground">
          {fmtTime(item.createdAt)}
          {item.text ? ` · ${item.text}` : ''}
        </div>
      </button>
      {item.status === 'failed' && !item.result && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Erneut versuchen"
          onClick={async () => {
            await db.aiQueue.update(item.localId!, { status: 'pending', error: undefined });
            void processQueue(db);
          }}
        >
          <RotateCcw aria-hidden />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Verwerfen"
        onClick={() => void discardQueueItem(db, item.localId!)}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

const CONFIDENCE = { low: 'unsicher', medium: 'mittel', high: 'sicher' } as const;

/** Review content while a re-analysis runs: greyed out and not interactive. */
const BUSY = 'pointer-events-none opacity-45 saturate-50 select-none';

/** Range of the "Gesamtmenge" slider (factor on all ingredients). */
const SCALE_MIN = 0.25;
const SCALE_MAX = 3;

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
  const image = useAiImage(item);
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
  const rescale = (factor: number) => {
    setScale(factor);
    commit(scaleDraft(draft, scaleBase, factor));
  };

  const resolved = rows
    .map((r) => {
      const food = r.candidates.find((c) => c.id === r.foodId);
      if (!food || !r.grams || r.grams <= 0) return null;
      return {
        row: r,
        food,
        ...computeItem({ per100: food.nutrients, portionLabel: '1 g', portionGrams: 1, quantity: r.grams }),
      };
    })
    .filter((x) => x !== null);
  const totals = sumNutrients(resolved.map((r) => r.nutrients));
  const targets = targetsForDate(goals ?? [], item.date);

  function searchIngredient(q?: string) {
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
      const items = resolved.map((r) => ({ food: r.food, grams: r.grams }));
      id = await createAiMeal(db, newName, items, image ?? null);
    }
    commit({ ...draft, mealName: newName, savedMealId: id });
    toast.success(`„${newName}“ gespeichert`);
  }

  /**
   * "Meal eintragen": attached to the saved meal (which takes over the current ingredients) when
   * the review was saved, otherwise as one named group without a meal and without the photo.
   */
  async function log() {
    const items = resolved.map((r) => ({ food: r.food, grams: r.grams }));
    const target = { date: item.date, meal };
    if (savedMealId) await logAiMeal(db, savedMealId, name, items, target, result);
    else await logAiItems(db, name, items, target, result);
    for (const r of resolved) await rememberFood(db, r.food);
    await discardQueueItem(db, item.localId!);
    if (savedMealId)
      toast.success(`„${name}“ eingetragen`, {
        description: 'Unter „Gespeicherte Meals“ kannst du es jederzeit wieder eintragen und bearbeiten.',
      });
    else toast.success(`„${name}“ eingetragen`);
    await navigate({ to: '/', search: { date: item.date } });
  }

  return (
    <Page
      title="Ergebnis prüfen"
      back
      withTabBar={false}
      footer={
        <Button
          size="lg"
          disabled={busy || resolved.length === 0}
          className={cn(busy && 'saturate-50')}
          onClick={() => void log()}
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
              className="flex h-8 items-center gap-1 rounded-full bg-good/10 px-2.5 text-sm font-medium text-good focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-40"
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
      <div className="relative mb-4 overflow-hidden rounded-2xl border border-border/70">
        <MealPhoto
          blob={image}
          blobKey={`ai:${item.localId}`}
          alt="Analysiertes Foto"
          className="aspect-[4/3] w-full"
        />
        {busy && <AnalyzingOverlay />}
      </div>
      <div className={cn('grid', busy && BUSY)} aria-busy={busy || undefined}>
        {result.notes && <p className="mb-4 rounded-xl bg-muted p-3 text-sm text-pretty">{result.notes}</p>}
        {rows.length === 0 && (
          <EmptyState title="Kein Essen erkannt">
            Versuche ein Foto von schräg oben bei gutem Licht oder füge die Zutaten selbst hinzu.
          </EmptyState>
        )}
        <div className="mb-4 grid gap-1.5">
          <Label htmlFor="review-hint">Hinweis für die Analyse</Label>
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
        {rows.map((r) => {
          const food = r.candidates.find((c) => c.id === r.foodId);
          const kcal = food && r.grams ? (get(food.nutrients, N.kcal) * r.grams) / 100 : 0;
          return (
            <Section key={r.key}>
              <div className="grid gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold">{r.name}</div>
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
                  <div className="flex items-center gap-1">
                    <span className="tabular font-semibold">{fmt0(kcal)} kcal</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${r.name} entfernen`}
                      onClick={() => commitRows({ ...draft, rows: rows.filter((x) => x.key !== r.key) })}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
                {r.candidates.length > 1 ? (
                  <div className="grid gap-1.5">
                    <Label htmlFor={`cand-${r.key}`}>Lebensmittel aus der Datenbank</Label>
                    <Select value={r.foodId ?? ''} onValueChange={(v) => update(r.key, { foodId: v })}>
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
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : r.candidates.length === 1 ? (
                  <p className="text-sm text-muted-foreground">
                    {r.candidates[0]!.name}
                    {r.candidates[0]!.brand ? ` (${r.candidates[0]!.brand})` : ''} ·{' '}
                    {fmt0(get(r.candidates[0]!.nutrients, N.kcal))} kcal/100 g
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Kein passendes Lebensmittel gefunden, wird nicht gespeichert.{' '}
                    <button
                      type="button"
                      onClick={() => searchIngredient(r.name)}
                      className="text-primary underline"
                    >
                      Selbst suchen
                    </button>
                  </p>
                )}
                <div className="grid grid-cols-[1fr_7rem] items-end gap-3">
                  <Slider
                    aria-label={`Menge ${r.name}`}
                    min={0}
                    // Based on the scale reference, so scaling up does not pin the thumb to the end.
                    max={rowSliderMax(scaleBase[r.key] ?? r.grams, r.grams)}
                    step={5}
                    value={[r.grams ?? 0]}
                    onValueChange={([v]) => update(r.key, { grams: v ?? 0 })}
                    className="mb-4"
                  />
                  <NumberField
                    label="Gramm"
                    unit={food?.unit ?? 'g'}
                    value={r.grams}
                    onValueChange={(g) => update(r.key, { grams: g })}
                    integer
                  />
                </div>
                {food && r.grams ? (
                  <NutrientsDisclosure
                    title={fmtGrams(r.grams, food.unit)}
                    nutrients={scaleNutrients(food.nutrients, r.grams)}
                    targets={targets}
                  />
                ) : null}
              </div>
            </Section>
          );
        })}
        <Button variant="outline" className="mb-4 w-full" onClick={() => searchIngredient()}>
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
