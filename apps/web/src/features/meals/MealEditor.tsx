import {
  mealPer100,
  mealRawGrams,
  N,
  get,
  sumNutrients,
  targetsForDate,
  type Meal,
  type MealItem,
} from '@ft/shared';
import { useBlocker, useNavigate, useRouter, type ShouldBlockFn } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ImagePlus, Plus, Salad, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DiscardDialog } from '@/components/DiscardDialog';
import { MealPhoto } from '@/components/MealPhoto';
import { NameDialog } from '@/components/NameDialog';
import { NumberField } from '@/components/NumberField';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { Page, Section } from '@/components/Page';
import { ConflictBanner } from '@/components/ConflictBanner';
import { ScalePresets } from '@/components/ScalePresets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  clearMealDraft,
  draftFromMeal,
  isMealDraftStale,
  isDirty,
  readMealDraft,
  readMealDraftPhoto,
  saveMealDraft,
  setMealDraftPhoto,
  writeMealDraft,
  type MealDraft,
  type MealDraftPhoto,
} from '@/db/mealDraft';
import { saveMealAsFood } from '@/db/entries';
import { deleteRecord, restoreRecord } from '@/db/write';
import { compressImage, IMAGE_PRESETS } from '@/features/ai/image';
import { useGoals, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmtGrams, fmtPercent } from '@/lib/format';
import { goBackOr } from '@/lib/history';
import { rememberIntoStart } from '@/lib/into';
import { IngredientCard, SCALE_MAX, SCALE_MIN, scaleItems } from './IngredientCard';

/**
 * Editor of a saved meal (Mehr → Gespeicherte Meals): photo, name, ingredients with amount wheels,
 * total amount and nutrients. Nothing is logged here and nothing is written until "Speichern"; the
 * draft lives in `kv` (see `db/mealDraft.ts`) and leaving with changes asks first. A new meal
 * ("Neues Meal", `isNew` draft, `meal` is a placeholder) saves once it has a name and an ingredient.
 */
export function MealEditor({ meal, fromLog = false }: { meal: Meal; fromLog?: boolean }) {
  const db = useDb();
  const draft = useLiveQuery(() => readMealDraft(db, meal.id), [db, meal.id]);
  const photo = useLiveQuery(() => readMealDraftPhoto(db, meal.id), [db, meal.id]);
  // The meal changed since the draft started (another device). A draft that does not differ from the
  // new meal is just old and dropped; one with changes gets the conflict banner in the form.
  const stale = !!draft && isMealDraftStale(draft, meal);
  const conflict = stale && (isDirty(draft, meal) || photo !== null);
  useEffect(() => {
    if (stale && !conflict) void clearMealDraft(db, meal.id);
  }, [stale, conflict, db, meal.id]);
  // Mount only once both answered, or the form would start from the saved meal and miss the draft.
  if (draft === undefined || photo === undefined) return null;
  if (stale && !conflict) return null;
  return (
    <MealEditorForm
      // Without a draft the form follows the meal; with one it keeps its base until the person decides.
      key={`${meal.id}:${draft ? (draft.baseUpdatedAt ?? 'draft') : meal.updatedAt}`}
      meal={meal}
      initial={draft ?? draftFromMeal(meal)}
      photo={photo}
      fromLog={fromLog}
      conflict={
        conflict
          ? {
              reload: () => void clearMealDraft(db, meal.id),
              keep: () => void writeMealDraft(db, { ...draft, baseUpdatedAt: meal.updatedAt }),
            }
          : null
      }
    />
  );
}

function MealEditorForm({
  meal,
  initial,
  photo,
  fromLog,
  conflict,
}: {
  meal: Meal;
  initial: MealDraft;
  photo: MealDraftPhoto | null;
  fromLog: boolean;
  conflict: { reload: () => void; keep: () => void } | null;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const goals = useGoals();
  const [draft, setDraft] = useState(initial);
  /** Write-through: local state for smooth typing, the `kv` draft for surviving navigation. */
  const commit = (next: MealDraft) => {
    setDraft(next);
    void writeMealDraft(db, next);
  };
  // "Gesamtmenge" scales the amounts of the last manual change (`scaleBase`), like the AI review.
  const [scale, setScale] = useState(1);
  const [scaleBase, setScaleBase] = useState<MealItem[]>(initial.items);
  const commitItems = (items: MealItem[]) => {
    commit({ ...draft, items });
    setScale(1);
    setScaleBase(items);
  };
  // While the slider is dragged only the screen follows; the draft is written when it is let go.
  const rescale = (factor: number) => {
    setScale(factor);
    setDraft({ ...draft, items: scaleItems(scaleBase, factor) });
  };

  const isNew = draft.isNew === true;
  const dirty = isDirty(draft, meal);
  // A new meal needs a name and an ingredient (the schema wants at least one).
  const canSave = dirty && (!isNew || (draft.name.trim().length > 0 && draft.items.length > 0));
  const into = `meal:${meal.id}`;
  // Set right before leaving after a save or delete: the meal prop still shows the old state then.
  const leaving = useRef(false);
  // The way through the ingredient search keeps the draft, so it does not count as leaving.
  const shouldBlockFn = useCallback<ShouldBlockFn>(
    ({ next }) => {
      const toSearch = next.pathname === '/add' && (next.search as { into?: string }).into === into;
      // A new meal left without any input leaves nothing behind.
      if (isNew && !dirty && !toSearch && !leaving.current) void clearMealDraft(db, meal.id);
      return !leaving.current && dirty && !toSearch;
    },
    [dirty, into, isNew, db, meal.id],
  );
  const blocker = useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false });

  const name = draft.name.trim() || meal.name || 'Neues Meal';
  const totals = sumNutrients(draft.items.map((i) => i.nutrients));
  const today = useToday();
  const targets = targetsForDate(goals ?? [], today);
  // Recipe mode: the raw sum of the ingredients, the weight after cooking, and the kcal per 100 g.
  const rawGrams = mealRawGrams(draft.items);
  const cooked = draft.cookedGrams ?? null;
  const per100 = mealPer100({ items: draft.items, cookedGrams: cooked });
  const [foodOpen, setFoodOpen] = useState(false);

  async function saveAsFood(foodName: string) {
    const id = await saveMealAsFood(db, { name, items: draft.items, cookedGrams: cooked }, foodName);
    if (!id)
      return void toast.error(
        'Das Meal hat kein Gewicht: trage Mengen oder das Gewicht nach dem Kochen ein.',
      );
    toast.success(`„${foodName}“ als Lebensmittel gespeichert`, {
      description: 'Unter „Eigene Lebensmittel“ und in der Suche, pro 100 g.',
    });
  }

  async function save(): Promise<boolean> {
    if (!canSave) {
      toast.error('Ein neues Meal braucht einen Namen und mindestens eine Zutat.');
      return false;
    }
    const ok = await saveMealDraft(db, draft);
    if (!ok) {
      toast.error('Das Meal gibt es nicht mehr.');
      return false;
    }
    setDraft({ ...draft, photo: 'keep' });
    toast.success(`„${name}“ gespeichert`);
    return true;
  }

  /** Saving closes the editor: back to the page that opened it ("Meal eintragen" or the list). */
  const { busy: saving, run } = useSubmitting();
  async function saveAndClose() {
    if (!(await save())) return;
    leaving.current = true;
    goBackOr(router.history, 1, () => void navigate({ to: '/meals', ignoreBlocker: true }));
  }

  async function remove() {
    await deleteRecord(db, 'meals', meal.id);
    await clearMealDraft(db, meal.id);
    toast(`${meal.name} gelöscht`, {
      action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'meals', meal.id) },
    });
    leaving.current = true;
    // From "Meal eintragen" back past that page (it would show a deleted meal), else to the list.
    goBackOr(router.history, fromLog ? 2 : 1, () => void navigate({ to: '/meals', ignoreBlocker: true }));
  }

  function addIngredient() {
    rememberIntoStart(router.history);
    void navigate({ to: '/add', search: { date: today, meal: 0, into } });
  }

  return (
    <Page
      title={name}
      back="/meals"
      withTabBar={false}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Als Lebensmittel speichern"
            disabled={saving || !per100}
            onClick={() => setFoodOpen(true)}
          >
            <Salad aria-hidden />
          </Button>
          {!isNew && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Meal löschen"
              disabled={saving}
              onClick={() => void run(remove)}
            >
              <Trash2 className="text-destructive" aria-hidden />
            </Button>
          )}
        </>
      }
      footer={
        <Button size="lg" disabled={!canSave || saving} onClick={() => void run(saveAndClose)}>
          Speichern
        </Button>
      }
    >
      {conflict && <ConflictBanner onReload={conflict.reload} onKeep={conflict.keep} />}
      <PhotoSection meal={meal} draft={draft} photo={photo} name={name} onChange={commit} />
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="meal-name">Name</Label>
          <Input
            id="meal-name"
            autoComplete="off"
            maxLength={120}
            value={draft.name}
            placeholder={isNew ? 'z. B. Overnight Oats' : undefined}
            onChange={(e) => commit({ ...draft, name: e.target.value })}
          />
        </div>
      </Section>
      {draft.items.map((item, i) => (
        <IngredientCard
          key={i}
          item={item}
          removable={draft.items.length > 1}
          targets={targets}
          onChange={(next) =>
            setDraft({ ...draft, items: draft.items.map((it, j) => (j === i ? next : it)) })
          }
          onCommit={(next) => commitItems(draft.items.map((it, j) => (j === i ? next : it)))}
          onRemove={() => commitItems(draft.items.filter((_, j) => j !== i))}
        />
      ))}
      <Button variant="outline" className="mb-2 w-full" onClick={addIngredient}>
        <Plus aria-hidden /> Zutat hinzufügen
      </Button>
      <p className="mb-4 px-1 text-xs text-muted-foreground text-pretty">
        {isNew
          ? 'Füge Lebensmittel oder ein anderes Meal als Zutaten hinzu. Eingetragen wird es später über die Suche.'
          : 'Änderungen gelten für künftige Einträge. Bereits eingetragene Tage bleiben, wie sie sind.'}
      </p>
      <Section>
        <div className="grid gap-3 p-4">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <Label htmlFor="meal-scale">Gesamtmenge</Label>
                <p id="meal-scale-hint" className="text-xs text-muted-foreground">
                  Skaliert alle Zutaten
                </p>
              </div>
              <output htmlFor="meal-scale" className="tabular text-lg font-semibold">
                {fmtPercent(scale)}
              </output>
            </div>
            <Slider
              id="meal-scale"
              aria-label="Gesamtmenge skalieren"
              aria-describedby="meal-scale-hint"
              aria-valuetext={fmtPercent(scale)}
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={0.05}
              value={[scale]}
              onValueChange={([v]) => v !== undefined && rescale(v)}
              // From the commit value, not the draft of this render (keyboard steps change and commit at once).
              onValueCommit={([v]) => void writeMealDraft(db, { ...draft, items: scaleItems(scaleBase, v!) })}
            />
            <ScalePresets
              value={scale}
              onPick={(f) => {
                setScale(f);
                commit({ ...draft, items: scaleItems(scaleBase, f) });
              }}
            />
          </div>
          <NutrientBreakdown title="Summe" nutrients={totals} targets={targets} />
        </div>
      </Section>
      <Section title="Rezept">
        <div className="grid gap-3 px-4 pb-4">
          <NumberField
            label="Gewicht nach dem Kochen (optional)"
            unit="g"
            integer
            value={cooked}
            onValueChange={(v) => commit({ ...draft, cookedGrams: v && v > 0 ? Math.round(v) : null })}
            hint={
              rawGrams > 0
                ? `Zutaten roh ${fmtGrams(rawGrams)}. Mit dem Gewicht nach dem Kochen rechnet die App pro 100 g gekocht; beim Eintragen kannst du dann die gegessenen Gramm angeben.`
                : 'Mit dem Gewicht nach dem Kochen rechnet die App pro 100 g gekocht.'
            }
          />
          {per100 && (
            <p className="tabular text-sm text-muted-foreground">
              Pro 100 g {cooked ? 'gekocht' : 'roh'}: {fmt0(get(per100, N.kcal))} kcal · P{' '}
              {fmt0(get(per100, N.protein))} · K {fmt0(get(per100, N.carbs))} · F {fmt0(get(per100, N.fat))}
            </p>
          )}
        </div>
      </Section>
      <NameDialog
        open={foodOpen}
        onOpenChange={setFoodOpen}
        title="Als Lebensmittel speichern"
        description={`Die Zutaten werden pro 100 g ${cooked ? 'gekocht' : ''} als eigenes Lebensmittel gespeichert, mit der Portion „Ganzes Rezept“. Das Meal bleibt erhalten.`}
        confirmLabel="Lebensmittel speichern"
        defaultName={name}
        maxLength={200}
        onConfirm={saveAsFood}
      />
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name={name}
        onKeepEditing={() => blocker.reset?.()}
        onDiscard={async () => {
          await clearMealDraft(db, meal.id);
          blocker.proceed?.();
        }}
        onSave={async () => {
          if (await save()) blocker.proceed?.();
          else blocker.reset?.();
        }}
      />
    </Page>
  );
}

/** Photo of the draft: the saved one, a newly picked one (bytes in `kv`), or none. */
function PhotoSection({
  meal,
  draft,
  photo,
  name,
  onChange,
}: {
  meal: Meal;
  draft: MealDraft;
  photo: MealDraftPhoto | null;
  name: string;
  onChange: (draft: MealDraft) => void;
}) {
  const db = useDb();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pending = draft.photo === 'pending' && photo ? photo : null;
  const savedId = draft.photo === 'keep' ? meal.photoId : null;

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressImage(file, IMAGE_PRESETS.mealPhoto);
      await setMealDraftPhoto(db, meal.id, {
        bytes: await blob.arrayBuffer(),
        type: blob.type || 'image/jpeg',
        at: Date.now(),
      });
      onChange({ ...draft, photo: 'pending' });
    } catch {
      toast.error('Das Bild konnte nicht gelesen werden. Versuche ein anderes Foto.');
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    await setMealDraftPhoto(db, meal.id, null);
    onChange({ ...draft, photo: meal.photoId ? 'remove' : 'keep' });
  }

  const input = (ref: typeof camera, capture: boolean) => (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      {...(capture ? { capture: 'environment' as const } : {})}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        void pick(e.target.files?.[0]);
        e.target.value = '';
      }}
    />
  );

  return (
    <Section>
      {input(camera, true)}
      {input(gallery, false)}
      {pending || savedId ? (
        <div className="relative">
          {pending ? (
            <MealPhoto
              blob={new Blob([pending.bytes], { type: pending.type })}
              blobKey={`mealDraft:${meal.id}:${pending.at}`}
              alt={`Foto von ${name}`}
              className="aspect-[4/3] w-full"
            />
          ) : (
            <MealPhoto photoId={savedId} alt={`Foto von ${name}`} className="aspect-[4/3] w-full" />
          )}
          <div className="absolute right-2 bottom-2 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => gallery.current?.click()}
              aria-label="Foto ändern"
            >
              <ImagePlus aria-hidden /> Ändern
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              disabled={busy}
              aria-label="Foto entfernen"
              onClick={() => void removePhoto()}
            >
              <X aria-hidden />
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-4">
          <Button
            variant="outline"
            className="h-20 flex-col gap-1"
            disabled={busy}
            onClick={() => camera.current?.click()}
          >
            <Camera className="size-6 text-primary" aria-hidden /> Foto aufnehmen
          </Button>
          <Button
            variant="outline"
            className="h-20 flex-col gap-1"
            disabled={busy}
            onClick={() => gallery.current?.click()}
          >
            <ImagePlus className="size-6 text-primary" aria-hidden /> Aus Mediathek
          </Button>
        </div>
      )}
    </Section>
  );
}
