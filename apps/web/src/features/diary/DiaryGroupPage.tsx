import { sumNutrients, targetsForDate, type FoodEntry, type MealItem } from '@ft/shared';
import {
  useBlocker,
  useNavigate,
  useParams,
  useRouter,
  useSearch,
  type ShouldBlockFn,
} from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DiscardDialog } from '@/components/DiscardDialog';
import { MealPhoto } from '@/components/MealPhoto';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import {
  clearGroupDraft,
  draftFromEntries,
  groupEntries,
  groupName,
  isGroupDirty,
  readGroupDraft,
  saveGroupDraft,
  writeGroupDraft,
  type GroupDraft,
  type GroupDraftItem,
} from '@/db/groupDraft';
import { IngredientCard, SCALE_MAX, SCALE_MIN, scaleItems } from '@/features/meals/IngredientCard';
import { useGoals } from '@/hooks/data';
import { fmtPercent } from '@/lib/format';
import { goBackOr } from '@/lib/history';
import { rememberIntoStart } from '@/lib/into';
import { removeEntriesWithUndo } from './MealCard';

interface GroupData {
  entries: FoodEntry[];
  /** The name the diary row shows (own name, else the saved meal's). */
  name: string;
  /** Saved meal the group was logged from (also a deleted one), for the hint and the photo. */
  meal: { name: string; photoId: string | null } | null;
}

/**
 * Editor of one diary group (entries logged together from a saved meal or an AI analysis), opened
 * by tapping its row in the diary: name, amounts per ingredient and in total, remove and add
 * ingredients. It changes only these diary entries, never the saved meal. Nothing is written until
 * "Änderungen übernehmen"; the draft lives in `kv` (see `db/groupDraft.ts`) and leaving with changes
 * asks first.
 */
export function DiaryGroupPage() {
  const { groupId } = useParams({ from: '/authed/diary-group/$groupId' });
  const { date } = useSearch({ from: '/authed/diary-group/$groupId' });
  const db = useDb();
  const data = useLiveQuery(async (): Promise<GroupData> => {
    const entries = await groupEntries(db, groupId, date);
    const mealId = entries[0]?.mealId;
    const meal = mealId ? await db.meals.get(mealId) : undefined;
    return {
      entries,
      name: await groupName(db, entries),
      meal: meal ? { name: meal.name, photoId: meal.photoId ?? null } : null,
    };
  }, [db, groupId, date]);
  const draft = useLiveQuery(() => readGroupDraft(db, groupId), [db, groupId]);

  // Mount only once both answered, or the form would start from the entries and miss the draft.
  if (data === undefined || draft === undefined)
    return (
      <Page title="Eintrag" back="/" withTabBar={false}>
        <div className="grid gap-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </Page>
    );
  if (data.entries.length === 0)
    return (
      <Page title="Eintrag" back="/" withTabBar={false}>
        <EmptyState title="Eintrag nicht gefunden" />
      </Page>
    );
  return (
    <DiaryGroupForm key={groupId} data={data} initial={draft ?? draftFromEntries(data.entries, data.name)} />
  );
}

function DiaryGroupForm({ data, initial }: { data: GroupData; initial: GroupDraft }) {
  const { entries, meal } = data;
  const first = entries[0]!;
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const goals = useGoals();
  const [draft, setDraft] = useState(initial);
  /** Write-through: local state for smooth typing, the `kv` draft for surviving navigation. */
  const commit = (next: GroupDraft) => {
    setDraft(next);
    void writeGroupDraft(db, next);
  };
  // "Gesamtmenge" scales the amounts of the last manual change (`scaleBase`), like the meal editor.
  const [scale, setScale] = useState(1);
  const [scaleBase, setScaleBase] = useState<GroupDraftItem[]>(initial.items);
  const commitItems = (items: GroupDraftItem[]) => {
    commit({ ...draft, items });
    setScale(1);
    setScaleBase(items);
  };
  // While the slider is dragged only the screen follows; the draft is written when it is let go.
  const rescale = (factor: number) => {
    setScale(factor);
    setDraft({ ...draft, items: scaleItems(scaleBase, factor) });
  };

  const dirty = isGroupDirty(draft, entries, data.name);
  const into = `group:${draft.groupId}`;
  // Set right before leaving after a save or delete: the entries still show the old state then.
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

  const name = draft.name.trim() || data.name;
  const totals = sumNutrients(draft.items.map((i) => i.nutrients));
  const targets = targetsForDate(goals ?? [], draft.date);
  const photoId = first.photoId || meal?.photoId || null;
  const back = () => void navigate({ to: '/', search: { date: draft.date }, ignoreBlocker: true });

  async function save(): Promise<boolean> {
    const ok = await saveGroupDraft(db, draft);
    if (!ok) {
      toast.error('Den Eintrag gibt es nicht mehr.');
      return false;
    }
    toast.success('Änderungen übernommen');
    return true;
  }

  /** Taking over the changes closes the editor (back to the diary or the diary meal page). */
  async function saveAndClose() {
    if (!(await save())) return;
    leaving.current = true;
    goBackOr(router.history, 1, back);
  }

  async function remove() {
    await clearGroupDraft(db, draft.groupId);
    await removeEntriesWithUndo(db, entries, `${data.name} gelöscht`);
    leaving.current = true;
    goBackOr(router.history, 1, back);
  }

  function addIngredient() {
    rememberIntoStart(router.history);
    void navigate({ to: '/add', search: { date: draft.date, meal: first.meal, into } });
  }

  return (
    <Page
      title={name}
      back="/"
      withTabBar={false}
      actions={
        <Button variant="ghost" size="icon" aria-label="Eintrag löschen" onClick={() => void remove()}>
          <Trash2 className="text-destructive" aria-hidden />
        </Button>
      }
      footer={
        <Button size="lg" disabled={!dirty} onClick={() => void saveAndClose()}>
          Änderungen übernehmen
        </Button>
      }
    >
      {photoId && (
        <Section>
          <MealPhoto photoId={photoId} alt={`Foto von ${name}`} className="aspect-[4/3] w-full" />
        </Section>
      )}
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="group-name">Name</Label>
          <Input
            id="group-name"
            autoComplete="off"
            maxLength={120}
            value={draft.name}
            onChange={(e) => commit({ ...draft, name: e.target.value })}
          />
        </div>
      </Section>
      {draft.items.map((item, i) => (
        <IngredientCard
          key={item.entryId ?? `new-${i}`}
          index={i}
          item={item}
          removable={draft.items.length > 1}
          targets={targets}
          onChange={(next: MealItem) =>
            setDraft({
              ...draft,
              items: draft.items.map((it, j) => (j === i ? { ...next, entryId: it.entryId } : it)),
            })
          }
          onCommit={(next: MealItem) =>
            commitItems(draft.items.map((it, j) => (j === i ? { ...next, entryId: it.entryId } : it)))
          }
          onRemove={() => commitItems(draft.items.filter((_, j) => j !== i))}
        />
      ))}
      <Button variant="outline" className="mb-2 w-full" onClick={addIngredient}>
        <Plus aria-hidden /> Zutat hinzufügen
      </Button>
      {first.mealId && (
        <p className="mb-4 px-1 text-xs text-muted-foreground text-pretty">
          Ändert nur diesen Eintrag. Das gespeicherte Meal{meal ? ` „${meal.name}“` : ''} bleibt, wie es ist.
        </p>
      )}
      <Section>
        <div className="grid gap-3 p-4">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <Label htmlFor="group-scale">Gesamtmenge</Label>
                <p id="group-scale-hint" className="text-xs text-muted-foreground">
                  Skaliert alle Zutaten
                </p>
              </div>
              <output htmlFor="group-scale" className="tabular text-lg font-semibold">
                {fmtPercent(scale)}
              </output>
            </div>
            <Slider
              id="group-scale"
              aria-label="Gesamtmenge skalieren"
              aria-describedby="group-scale-hint"
              aria-valuetext={fmtPercent(scale)}
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={0.05}
              value={[scale]}
              onValueChange={([v]) => v !== undefined && rescale(v)}
              onValueCommit={() => void writeGroupDraft(db, draft)}
            />
          </div>
          <NutrientBreakdown title="Summe" nutrients={totals} targets={targets} />
        </div>
      </Section>
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name={data.name}
        apply
        onKeepEditing={() => blocker.reset?.()}
        onDiscard={async () => {
          await clearGroupDraft(db, draft.groupId);
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
