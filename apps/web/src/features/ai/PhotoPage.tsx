import { computeItem, get, N, sumNutrients, type AiAnalysisResult } from '@ft/shared';
import { useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Camera,
  Images,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import {
  BarcodeScanner,
  detectBarcodeInImage,
  TorchButton,
  type CaptureFn,
  type ScannerError,
  type TorchState,
} from '@/components/BarcodeScanner';
import { MacroSplitBar } from '@/components/MacroBars';
import { MealPhoto, useObjectUrl } from '@/components/MealPhoto';
import { NumberField } from '@/components/NumberField';
import { EmptyState, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { currentDraft, patchRow, rowGrams, scaleDraft, type RowGrams } from '@/db/aiDraft';
import type { AiDraft, AiDraftRow, AiQueueItem } from '@/db/dexie';
import { logAiItems, saveAiMeal } from '@/db/entries';
import { rememberFood } from '@/foods/foodService';
import { useSettings } from '@/hooks/data';
import { endpoints } from '@/lib/api';
import { fmt0, fmtIngredients, fmtPercent, fmtTime } from '@/lib/format';
import { rememberIntoStart } from '@/lib/into';
import { compressImage } from './image';
import { enqueuePhoto, processQueue } from './queue';

export function PhotoPage() {
  const { date, meal, review } = useSearch({ from: '/authed/photo' });
  const navigate = useNavigate({ from: '/photo' });
  const db = useDb();
  const queue = useLiveQuery(() => db.aiQueue.orderBy('createdAt').reverse().toArray(), [db]);
  // The open analysis lives in the URL, so returning from the food search lands in it again.
  const setActiveId = (id: number | null) =>
    void navigate({ search: (s) => ({ ...s, review: id ?? undefined }), replace: id === null });
  const activeId = review ?? null;
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    endpoints.aiStatus().then(
      (s) => setAiEnabled(s.enabled),
      () => setAiEnabled(null),
    );
    void processQueue(db);
  }, [db]);

  const active = queue?.find((q) => q.localId === activeId);
  if (active?.status === 'done' && active.result) {
    return <ResultEditor key={active.localId} item={active} onClose={() => setActiveId(null)} />;
  }

  return (
    <Page title="Foto / Scan" back withTabBar={false}>
      {aiEnabled === false && (
        <p role="alert" className="mb-4 flex gap-2 rounded-xl bg-warn/10 p-3 text-sm">
          <TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />
          Die Foto-Analyse ist auf dem Server nicht eingerichtet (ANTHROPIC_API_KEY fehlt).
        </p>
      )}
      <CameraCapture
        date={date}
        meal={meal}
        onQueued={setActiveId}
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
        Barcodes im Bild werden sofort erkannt und nachgeschlagen. Teller-Fotos gehen zur Analyse an Claude
        (Anthropic) und werden dort nicht gespeichert. Die Nährwerte stammen immer aus dem BLS bzw. Open Food
        Facts; die KI schätzt nur, was und wie viel auf dem Teller liegt (typisch ±20 bis 40&nbsp;%). Prüfe
        die Mengen vor dem Speichern.
      </p>
    </Page>
  );
}

const CAM_ERRORS: Record<ScannerError, string> = {
  permission: 'Kein Kamerazugriff. Erlaube die Kamera in den iOS-Einstellungen (Safari → Kamera).',
  'no-camera': 'Keine Kamera gefunden.',
  unsupported: 'Dieser Browser unterstützt keinen Kamerazugriff.',
  other: 'Die Kamera konnte nicht gestartet werden.',
};

/**
 * Live camera as the single entry point: a barcode in view is looked up immediately, the shutter
 * sends the frame to the AI, the gallery button (bottom left) analyzes a saved photo, the torch
 * toggle sits bottom right when the camera has one. The optional hint is typed before shooting so
 * that one tap on the shutter is all it takes.
 *
 * iOS limit: a file input without `capture` always opens the action sheet (photo library / take
 * photo / choose file); no web API opens the photo library directly.
 */
function CameraCapture({
  date,
  meal,
  onQueued,
  onBarcode,
}: {
  date: string;
  meal: number;
  onQueued: (id: number) => void;
  onBarcode: (code: string) => void;
}) {
  const db = useDb();
  const galleryInput = useRef<HTMLInputElement>(null);
  const fallbackCamera = useRef<HTMLInputElement>(null);
  const capture = useRef<CaptureFn | null>(null);
  const [camError, setCamError] = useState<ScannerError | null>(null);
  const [text, setText] = useState('');
  const [shot, setShot] = useState<Blob | null>(null);
  const preview = useObjectUrl(shot);
  const [torch, setTorch] = useState<TorchState>(null);
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

  async function analyze(image: Blob) {
    setBusy(true);
    setShot(image);
    try {
      const compressed = await compressImage(image);
      const id = await enqueuePhoto(db, { date, meal, text, image: compressed });
      await processQueue(db);
      const item = await db.aiQueue.get(id);
      if (item?.status === 'done') {
        onQueued(id);
        return;
      }
      if (item?.status === 'pending')
        toast('Offline. Das Foto wird analysiert, sobald du wieder verbunden bist.');
      else if (item?.status === 'failed') toast.error(item.error ?? 'Analyse fehlgeschlagen');
      setText('');
    } catch {
      toast.error('Das Bild konnte nicht gelesen werden. Versuche ein anderes Foto.');
    } finally {
      setBusy(false);
      setShot(null);
    }
  }

  async function shoot() {
    const blob = await capture.current?.();
    if (!blob) return toast.error('Die Kamera liefert noch kein Bild.');
    navigator.vibrate?.(30);
    await analyze(blob);
  }

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    // A photographed barcode skips the AI entirely and goes to the product lookup.
    const code = await detectBarcodeInImage(file);
    if (code) {
      setBusy(false);
      return onDetected(code);
    }
    await analyze(file);
  }

  const overlay = (
    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-4">
      <Button
        variant="secondary"
        size="icon-lg"
        className="rounded-xl bg-black/55 text-white hover:bg-black/70"
        aria-label="Foto aus der Mediathek analysieren"
        disabled={busy}
        onClick={() => galleryInput.current?.click()}
      >
        <Images className="size-6" aria-hidden />
      </Button>
      <button
        type="button"
        aria-label="Foto aufnehmen und analysieren"
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
      {preview ? (
        <div className="relative overflow-hidden rounded-2xl bg-black">
          <img src={preview} alt="Aufgenommenes Foto" className="aspect-[3/4] w-full object-cover" />
          {busy && <AnalyzingOverlay />}
        </div>
      ) : camError ? (
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
      <div className="grid gap-1.5">
        <Label htmlFor="ai-text">Hinweis für die Analyse (optional)</Label>
        <Input
          id="ai-text"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          placeholder="z. B. „mit Butter gebraten“, „halbe Portion“, „250 g Hähnchen“…"
        />
      </div>
    </div>
  );
}

/** Shown over the photo while Claude looks at it; pure CSS animation (see `.ai-*` in index.css). */
function AnalyzingOverlay() {
  return (
    <div
      role="status"
      className="absolute inset-0 grid place-items-center overflow-hidden rounded-xl bg-black/50 text-white"
    >
      <div className="ai-scan" aria-hidden />
      <div className="relative flex flex-col items-center gap-2 px-4 text-center">
        <Sparkles className="ai-pulse size-8" aria-hidden />
        <div className="text-lg font-semibold">Analysiere Foto…</div>
        <div className="ai-steps relative h-5 w-64 text-sm">
          <span>Erkenne Lebensmittel</span>
          <span>Schätze die Mengen</span>
          <span>Suche Nährwerte heraus</span>
        </div>
      </div>
    </div>
  );
}

function QueueRow({ item, onOpen }: { item: AiQueueItem; onOpen: () => void }) {
  const db = useDb();
  // Keyed by the queue id: every status change re-reads the item (and a new Blob) from IndexedDB.
  const thumb = useObjectUrl(item.image, `ai:${item.localId}`);
  const label =
    item.status === 'done'
      ? `${item.result?.items.length ?? 0} Lebensmittel erkannt, bitte prüfen`
      : item.status === 'pending'
        ? 'Wartet auf Verbindung'
        : item.status === 'analyzing'
          ? 'Wird analysiert…'
          : (item.error ?? 'Fehlgeschlagen');
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <div className="relative size-12 shrink-0">
        {thumb ? (
          <img src={thumb} alt="" width={48} height={48} className="size-12 rounded-lg object-cover" />
        ) : (
          <div className="size-12 rounded-lg bg-muted" />
        )}
        {item.status === 'analyzing' && (
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 text-white">
            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          </div>
        )}
      </div>
      <button
        type="button"
        className="min-w-0 flex-1 text-left disabled:cursor-default"
        disabled={item.status !== 'done'}
        onClick={onOpen}
      >
        <div className="truncate text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {fmtTime(item.createdAt)}
          {item.text ? ` · ${item.text}` : ''}
        </div>
      </button>
      {item.status === 'failed' && (
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
        onClick={() => void db.aiQueue.delete(item.localId!)}
      >
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

const CONFIDENCE = { low: 'unsicher', medium: 'mittel', high: 'sicher' } as const;

/** Range of the "Gesamtmenge" slider (factor on all ingredients). */
const SCALE_MIN = 0.25;
const SCALE_MAX = 3;

/** Upper end of an ingredient's gram slider: 2.5 × the reference amount, at least 50 g. */
function rowSliderMax(base: number | null, grams: number | null): number {
  const roundUp10 = (g: number) => Math.ceil(g / 10) * 10;
  return Math.max(50, roundUp10((base ?? 100) * 2.5), roundUp10(grams ?? 0));
}

/**
 * Review of a finished analysis. The working state is kept in component state for smooth typing and
 * written through to the queue item (`draft`), so adding an ingredient via the food search (or
 * closing the app) does not lose any edits.
 */
function ResultEditor({ item, onClose }: { item: AiQueueItem; onClose: () => void }) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const settings = useSettings();
  const result = item.result as AiAnalysisResult;
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

  function searchIngredient(q?: string) {
    rememberIntoStart(router.history);
    void navigate({
      to: '/add',
      search: { date: item.date, meal, into: `ai:${item.localId}`, ...(q ? { q } : {}) },
    });
  }

  /**
   * `asMeal`: saves a reusable meal with the photo and logs it. Otherwise ("Nur eintragen") the
   * ingredients are logged as one named group, without a saved meal and without the photo.
   */
  async function save(asMeal: boolean) {
    const name = mealName.trim() || 'Foto-Meal';
    const items = resolved.map((r) => ({ food: r.food, grams: r.grams }));
    const target = { date: item.date, meal };
    if (asMeal) await saveAiMeal(db, name, items, target, result, item.image);
    else await logAiItems(db, name, items, target, result);
    for (const r of resolved) await rememberFood(db, r.food);
    await db.aiQueue.delete(item.localId!);
    if (asMeal)
      toast.success(`„${name}“ eingetragen`, {
        description: 'Unter „Gespeicherte Meals“ kannst du es jederzeit wieder hinzufügen und bearbeiten.',
      });
    else toast.success(`„${name}“ eingetragen`);
    await navigate({ to: '/', search: { date: item.date } });
  }

  return (
    <Page
      title="Ergebnis prüfen"
      back
      withTabBar={false}
      actions={
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zurück zur Liste">
          <X aria-hidden />
        </Button>
      }
    >
      <div className="mb-4 overflow-hidden rounded-2xl border border-border/70">
        <MealPhoto
          blob={item.image}
          blobKey={`ai:${item.localId}`}
          alt="Analysiertes Foto"
          className="aspect-[4/3] w-full"
        />
      </div>
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="result-name">Name des Meals</Label>
          <Input
            id="result-name"
            value={mealName}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => commit({ ...draft, mealName: e.target.value })}
            placeholder="z. B. Spaghetti Bolognese…"
          />
        </div>
      </Section>
      {result.notes && <p className="mb-4 rounded-xl bg-muted p-3 text-sm text-pretty">{result.notes}</p>}
      {rows.length === 0 && (
        <EmptyState title="Kein Essen erkannt">
          Versuche ein Foto von schräg oben bei gutem Licht oder füge die Zutaten selbst hinzu.
        </EmptyState>
      )}
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
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">Summe</span>
            <span className="tabular text-2xl font-bold">{fmt0(get(totals, N.kcal))} kcal</span>
          </div>
          <MacroSplitBar
            protein={get(totals, N.protein)}
            carbs={get(totals, N.carbs)}
            fat={get(totals, N.fat)}
          />
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
          <Button size="lg" disabled={resolved.length === 0} onClick={() => void save(true)}>
            Als Meal speichern & eintragen
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={resolved.length === 0}
            onClick={() => void save(false)}
          >
            Nur eintragen
          </Button>
          <p className="text-xs text-muted-foreground text-pretty">
            {fmtIngredients(resolved.length)} werden mit dem Foto als Meal gespeichert und eingetragen. Unter
            „Gespeicherte Meals“ kannst du es später wieder hinzufügen und bearbeiten. Mit „Nur eintragen“
            landen die Zutaten als Gruppe im Tagebuch, ohne Meal und ohne Foto.
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
    </Page>
  );
}
