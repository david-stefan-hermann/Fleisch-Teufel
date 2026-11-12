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
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Check, PencilLine, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { AmountEditor, type Amount } from '@/components/AmountEditor';
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay';
import { warmUpCamera } from '@/components/cameraWarmup';
import { DayNote } from '@/components/DayNote';
import { HintCount, HintField } from '@/components/HintField';
import { NameDialog } from '@/components/NameDialog';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { NutrientsDisclosure } from '@/components/NutrientsDisclosure';
import { EmptyState, Page, Section } from '@/components/Page';
import { PhotoCaptureSheet } from '@/components/PhotoCaptureSheet';
import { PhotoStrip } from '@/components/PhotoStrip';
import { ScalePresets } from '@/components/ScalePresets';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
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
import { createAiMeal } from '@/db/entries';
import { patchRecord } from '@/db/write';
import { getFood, recentAndFrequent, rememberFood, userPortions, type FoodUsage } from '@/foods/foodService';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useGoals, useSettings, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { basePortion, editorPortions, isBasePortion, SCALE_MAX, SCALE_MIN } from '@/lib/amounts';
import { endpoints } from '@/lib/api';
import { fmt0, fmtIngredients, fmtPercent } from '@/lib/format';
import { rememberIntoStart } from '@/lib/into';
import { useReturnToDiary } from '@/lib/logFlow';
import { cn } from '@/lib/utils';
import { FAT_OPTIONS, isFatFood, type FatOption } from './fatSuggestion';
import { IMAGE_PRESETS } from './image';
import {
  addQueuePhotos,
  loadQueueImages,
  logReview,
  reanalyze,
  removeQueuePhoto,
  restoreQueuePhoto,
} from './queue';
import { addLabel, BUSY, CONFIDENCE } from './types';
import { useAiImages } from './useAiImage';

/**
 * Review of a finished analysis. The working state is kept in component state for smooth typing and
 * written through to the queue item (`draft`), so adding an ingredient via the food search (or
 * closing the app) does not lose any edits. The hint stays editable; ↻ sends the photo again with it
 * (asking first when the ingredients were changed). While that runs (`busy`) the review is greyed
 * out under the analysis overlay; X still leaves.
 */
export function ResultEditor({
  item,
  busy,
  onClose,
}: {
  item: AiQueueItem;
  busy: boolean;
  onClose: () => void;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const returnToDiary = useReturnToDiary();
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
    // Entries, photos and the removal of the analysis in one transaction (`logReview`).
    const ids = await logReview(db, { item, name, items, meal, savedMealId });
    // Logged already (a second tap that got through, or the queue run): nothing to say twice.
    if (ids === null) {
      await returnToDiary({ date: item.date, focus: { rows: [], meal } });
      return;
    }
    for (const r of resolved) await rememberFood(db, r.food);
    // Not awaited and allowed to fail (offline): the next analysis just does not know the choice.
    const choices = draftChoices(item, draft);
    if (choices.length > 0) void endpoints.aiChoices(result.analysisId, choices).catch(() => {});
    toast.success(`„${name}“ eingetragen`);
    // "Back" from the diary must not reopen the review of a logged analysis.
    await returnToDiary({ date: item.date, focus: { rows: ids, meal } });
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
      <DayNote date={item.date} />
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
              ? 'Fotos geändert, noch nicht neu analysiert'
              : `${fresh.length === 1 ? '1 Foto' : `${fresh.length} Fotos`} noch nicht analysiert`}
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
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                disabled={busy || (photos?.length ?? 0) >= MAX_ANALYSIS_PHOTOS}
                onClick={() => {
                  warmUpCamera();
                  setSheet(true);
                }}
              >
                <Camera aria-hidden /> Neues Foto
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => document.getElementById('review-hint')?.focus()}
              >
                <PencilLine aria-hidden /> Hinweis ergänzen
              </Button>
            </div>
          </EmptyState>
        )}
        <div className="mb-4 grid gap-1.5">
          <Label htmlFor="review-hint">
            {item.textOnly ? 'Beschreibung der Mahlzeit' : 'Hinweis für die Analyse'}
          </Label>
          <HintField
            id="review-hint"
            value={hint}
            disabled={busy}
            onChange={(e) => {
              setHint(e.target.value);
              void db.aiQueue.update(item.localId!, { text: e.target.value });
            }}
            placeholder="z. B. „mit Butter gebraten“, „halbe Portion“, „250 g Hähnchen“…"
            aria-describedby="review-hint-help"
          />
          <p id="review-hint-help" className="text-xs text-muted-foreground">
            <HintCount length={hint.length} />
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
                  <Label htmlFor="result-scale">Gesamtmenge</Label>
                  <output htmlFor="result-scale" className="tabular text-lg font-semibold">
                    {fmtPercent(scale)}
                  </output>
                </div>
                <Slider
                  id="result-scale"
                  aria-label="Gesamtmenge skalieren"
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
