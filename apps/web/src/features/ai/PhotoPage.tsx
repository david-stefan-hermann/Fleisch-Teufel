import { computeItem, get, N, sumNutrients, type AiAnalysisResult, type Food } from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ImagePlus, LoaderCircle, RotateCcw, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MacroSplitBar } from '@/components/MacroBars';
import { NumberField } from '@/components/NumberField';
import { EmptyState, Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import type { AiQueueItem } from '@/db/dexie';
import { saveAiItems } from '@/db/entries';
import { rememberFood } from '@/foods/foodService';
import { useSettings } from '@/hooks/data';
import { endpoints } from '@/lib/api';
import { fmt0, fmtTime } from '@/lib/format';
import { compressImage } from './image';
import { enqueuePhoto, processQueue } from './queue';

export function PhotoPage() {
  const { date, meal } = useSearch({ from: '/authed/photo' });
  const db = useDb();
  const queue = useLiveQuery(() => db.aiQueue.orderBy('createdAt').reverse().toArray(), [db]);
  const [activeId, setActiveId] = useState<number | null>(null);
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
    return <ResultEditor item={active} onClose={() => setActiveId(null)} />;
  }

  return (
    <Page title="Foto analysieren" back withTabBar={false}>
      {aiEnabled === false && (
        <p role="alert" className="mb-4 flex gap-2 rounded-xl bg-warn/10 p-3 text-sm">
          <TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />
          Die Foto-Analyse ist auf dem Server nicht eingerichtet (ANTHROPIC_API_KEY fehlt).
        </p>
      )}
      <Capture date={date} meal={meal} onQueued={setActiveId} />
      {queue && queue.length > 0 && (
        <Section title="Analysen" className="mt-4">
          <ul className="divide-y divide-border/70 pb-1">
            {queue.map((q) => (
              <QueueRow key={q.localId} item={q} onOpen={() => setActiveId(q.localId!)} />
            ))}
          </ul>
        </Section>
      )}
      <p className="mt-4 text-xs text-muted-foreground text-pretty">
        Das Foto wird zur Analyse an Claude (Anthropic) gesendet und nicht gespeichert. Die Nährwerte stammen
        immer aus dem BLS bzw. Open Food Facts; die KI schätzt nur, was und wie viel auf dem Teller liegt
        (typisch ±20–40&nbsp;%). Prüfe die Mengen vor dem Speichern. Verpackte Produkte lieber per Barcode
        erfassen.
      </p>
    </Page>
  );
}

function Capture({ date, meal, onQueued }: { date: string; meal: number; onQueued: (id: number) => void }) {
  const db = useDb();
  const settings = useSettings();
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const preview = useMemo(() => (image ? URL.createObjectURL(image) : null), [image]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const [text, setText] = useState('');
  const [targetMeal, setTargetMeal] = useState(meal);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      setImage(await compressImage(file));
    } catch {
      toast.error('Das Bild konnte nicht gelesen werden. Versuche ein anderes Foto.');
    }
  }

  async function analyze() {
    if (!image) return;
    setBusy(true);
    const id = await enqueuePhoto(db, { date, meal: targetMeal, text, image });
    await processQueue(db);
    const item = await db.aiQueue.get(id);
    setBusy(false);
    setImage(null);
    setText('');
    if (item?.status === 'done') onQueued(id);
    else if (item?.status === 'pending')
      toast('Offline – das Foto wird analysiert, sobald du wieder verbunden bist.');
    else if (item?.status === 'failed') toast.error(item.error ?? 'Analyse fehlgeschlagen');
  }

  return (
    <Section>
      <div className="grid gap-4 p-4">
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <input
          ref={galleryInput}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        {preview ? (
          <div className="relative">
            <img
              src={preview}
              alt="Ausgewähltes Foto"
              className="aspect-[4/3] w-full rounded-xl object-cover"
              width={800}
              height={600}
            />
            <Button
              variant="secondary"
              size="icon-sm"
              className="absolute top-2 right-2"
              onClick={() => setImage(null)}
              aria-label="Foto entfernen"
            >
              <X aria-hidden />
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-28 flex-col gap-2"
              onClick={() => cameraInput.current?.click()}
            >
              <Camera className="size-7 text-primary" aria-hidden /> Foto aufnehmen
            </Button>
            <Button
              variant="outline"
              className="h-28 flex-col gap-2"
              onClick={() => galleryInput.current?.click()}
            >
              <ImagePlus className="size-7 text-primary" aria-hidden /> Aus Mediathek
            </Button>
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="ai-text">Hinweise (optional)</Label>
          <Textarea
            id="ai-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="z. B. „mit Butter gebraten“, „halbe Portion gegessen“, „250 g Hähnchen“…"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ai-meal">Mahlzeit</Label>
          <Select value={String(targetMeal)} onValueChange={(v) => setTargetMeal(Number(v))}>
            <SelectTrigger id="ai-meal" className="w-full">
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
        <Button size="lg" disabled={!image || busy} onClick={() => void analyze()}>
          {busy ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Sparkles aria-hidden />
          )}
          {busy ? 'Analysiere… (bis zu 30 s)' : 'Analysieren'}
        </Button>
      </div>
    </Section>
  );
}

function QueueRow({ item, onOpen }: { item: AiQueueItem; onOpen: () => void }) {
  const db = useDb();
  const thumb = useMemo(() => URL.createObjectURL(item.image), [item.image]);
  useEffect(() => () => URL.revokeObjectURL(thumb), [thumb]);
  const label =
    item.status === 'done'
      ? `${item.result?.items.length ?? 0} Lebensmittel erkannt – prüfen`
      : item.status === 'pending'
        ? 'Wartet auf Verbindung'
        : item.status === 'analyzing'
          ? 'Wird analysiert…'
          : (item.error ?? 'Fehlgeschlagen');
  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <img src={thumb} alt="" width={48} height={48} className="size-12 rounded-lg object-cover" />
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

interface EditableItem {
  key: string;
  name: string;
  grams: number | null;
  confidence: 'low' | 'medium' | 'high';
  candidates: Food[];
  foodId: string | null;
}

const CONFIDENCE = { low: 'unsicher', medium: 'mittel', high: 'sicher' } as const;

function ResultEditor({ item, onClose }: { item: AiQueueItem; onClose: () => void }) {
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const result = item.result as AiAnalysisResult;
  const [meal, setMeal] = useState(item.meal);
  const [rows, setRows] = useState<EditableItem[]>(() =>
    result.items.map((it, i) => ({
      key: `${i}`,
      name: it.name,
      grams: Math.round(it.grams),
      confidence: it.confidence,
      candidates: it.candidates.map((c) => c.food),
      foodId: it.candidates[0]?.food.id ?? null,
    })),
  );
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
  const update = (key: string, patch: Partial<EditableItem>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save() {
    await saveAiItems(
      db,
      resolved.map((r) => ({ food: r.food, grams: r.grams })),
      { date: item.date, meal },
      result,
    );
    for (const r of resolved) await rememberFood(db, r.food);
    await db.aiQueue.delete(item.localId!);
    toast.success(`${resolved.length} Einträge aus dem Foto gespeichert`);
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
      {result.notes && <p className="mb-4 rounded-xl bg-muted p-3 text-sm text-pretty">{result.notes}</p>}
      {rows.length === 0 && (
        <EmptyState title="Kein Essen erkannt">Versuche ein Foto von schräg oben bei gutem Licht.</EmptyState>
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
                  <Badge variant={r.confidence === 'low' ? 'outline' : 'secondary'} className="mt-1">
                    KI: {CONFIDENCE[r.confidence]}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <span className="tabular font-semibold">{fmt0(kcal)} kcal</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${r.name} entfernen`}
                    onClick={() => setRows(rows.filter((x) => x.key !== r.key))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </div>
              {r.candidates.length > 0 ? (
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
              ) : (
                <p className="text-sm text-muted-foreground">
                  Kein passendes Lebensmittel gefunden – wird nicht gespeichert.{' '}
                  <Link
                    to="/add"
                    search={{ date: item.date, meal, q: r.name }}
                    className="text-primary underline"
                  >
                    Manuell suchen
                  </Link>
                </p>
              )}
              <div className="grid grid-cols-[1fr_7rem] items-end gap-3">
                <Slider
                  aria-label={`Menge ${r.name}`}
                  min={0}
                  max={Math.max(50, Math.round(((r.grams ?? 100) * 2.5) / 10) * 10)}
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

      <Section>
        <div className="grid gap-3 p-4">
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
            <Select value={String(meal)} onValueChange={(v) => setMeal(Number(v))}>
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
          <Button size="lg" disabled={resolved.length === 0} onClick={() => void save()}>
            {resolved.length} Einträge speichern
          </Button>
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
