import { sumNutrients, targetsForDate, today, type Meal, type MealItem } from '@ft/shared';
import { useBlocker, useNavigate, useRouter, type ShouldBlockFn } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DiscardDialog } from '@/components/DiscardDialog';
import { MealPhoto } from '@/components/MealPhoto';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  clearMealDraft,
  draftFromMeal,
  isDirty,
  readMealDraft,
  readMealDraftPhoto,
  saveMealDraft,
  setMealDraftPhoto,
  writeMealDraft,
  type MealDraft,
  type MealDraftPhoto,
} from '@/db/mealDraft';
import { deleteRecord, restoreRecord } from '@/db/write';
import { compressImage } from '@/features/ai/image';
import { useGoals } from '@/hooks/data';
import { fmtPercent } from '@/lib/format';
import { goBackOr } from '@/lib/history';
import { rememberIntoStart } from '@/lib/into';
import { IngredientCard, SCALE_MAX, SCALE_MIN, scaleItems } from './IngredientCard';

/**
 * Editor of a saved meal (Mehr → Gespeicherte Meals): photo, name, ingredients with amount sliders,
 * total amount and nutrients. Nothing is logged here and nothing is written until "Speichern"; the
 * draft lives in `kv` (see `db/mealDraft.ts`) and leaving with changes asks first.
 */
export function MealEditor({ meal, fromLog = false }: { meal: Meal; fromLog?: boolean }) {
  const db = useDb();
  const draft = useLiveQuery(() => readMealDraft(db, meal.id), [db, meal.id]);
  const photo = useLiveQuery(() => readMealDraftPhoto(db, meal.id), [db, meal.id]);
  // Mount only once both answered, or the form would start from the saved meal and miss the draft.
  if (draft === undefined || photo === undefined) return null;
  return (
    <MealEditorForm
      key={meal.id}
      meal={meal}
      initial={draft ?? draftFromMeal(meal)}
      photo={photo}
      fromLog={fromLog}
    />
  );
}

function MealEditorForm({
  meal,
  initial,
  photo,
  fromLog,
}: {
  meal: Meal;
  initial: MealDraft;
  photo: MealDraftPhoto | null;
  fromLog: boolean;
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
  const rescale = (factor: number) => {
    setScale(factor);
    commit({ ...draft, items: scaleItems(scaleBase, factor) });
  };

  const dirty = isDirty(draft, meal);
  const into = `meal:${meal.id}`;
  // Set right before leaving after a save or delete: the meal prop still shows the old state then.
  const leaving = useRef(false);
  // The way through the ingredient search keeps the draft, so it does not count as leaving.
  const shouldBlockFn = useCallback<ShouldBlockFn>(
    ({ next }) =>
      !leaving.current &&
      dirty &&
      !(next.pathname === '/add' && (next.search as { into?: string }).into === into),
    [dirty, into],
  );
  const blocker = useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false });

  const name = draft.name.trim() || meal.name;
  const totals = sumNutrients(draft.items.map((i) => i.nutrients));
  const targets = targetsForDate(goals ?? [], today());

  async function save(): Promise<boolean> {
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
    void navigate({ to: '/add', search: { date: today(), meal: 0, into } });
  }

  return (
    <Page
      title={name}
      back="/meals"
      withTabBar={false}
      actions={
        <Button variant="ghost" size="icon" aria-label="Meal löschen" onClick={() => void remove()}>
          <Trash2 className="text-destructive" aria-hidden />
        </Button>
      }
      footer={
        <Button size="lg" disabled={!dirty} onClick={() => void saveAndClose()}>
          Speichern
        </Button>
      }
    >
      <PhotoSection meal={meal} draft={draft} photo={photo} name={name} onChange={commit} />
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="meal-name">Name</Label>
          <Input
            id="meal-name"
            autoComplete="off"
            maxLength={120}
            value={draft.name}
            onChange={(e) => commit({ ...draft, name: e.target.value })}
          />
        </div>
      </Section>
      {draft.items.map((item, i) => (
        <IngredientCard
          key={i}
          index={i}
          item={item}
          base={scaleBase[i]?.quantity ?? item.quantity}
          removable={draft.items.length > 1}
          targets={targets}
          onChange={(next) => commitItems(draft.items.map((it, j) => (j === i ? next : it)))}
          onRemove={() => commitItems(draft.items.filter((_, j) => j !== i))}
        />
      ))}
      <Button variant="outline" className="mb-2 w-full" onClick={addIngredient}>
        <Plus aria-hidden /> Zutat hinzufügen
      </Button>
      <p className="mb-4 px-1 text-xs text-muted-foreground text-pretty">
        Änderungen gelten für künftige Einträge. Bereits eingetragene Tage bleiben, wie sie sind.
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
            />
          </div>
          <NutrientBreakdown title="Summe" nutrients={totals} targets={targets} />
        </div>
      </Section>
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name={meal.name}
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
      const blob = await compressImage(file, 600_000, 0.8);
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
