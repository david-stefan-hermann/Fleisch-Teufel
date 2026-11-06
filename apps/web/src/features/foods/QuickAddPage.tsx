import { get, N, type FoodEntry } from '@ft/shared';
import { Navigate, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { quickEntryText, saveQuickEntry } from '@/db/entries';
import { deleteRecord, restoreRecord } from '@/db/write';
import { useSettings } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { goBackOr } from '@/lib/history';
import {
  QuickEntryFields,
  quickEntryValid,
  quickEntryValues,
  type QuickEntryState,
} from './QuickEntryFields';

/**
 * A quick entry of the diary (values without a food, with the text the person wrote): the same
 * fields as "Eingeben" on the food page, with the full text and the diary meal. Only "Änderungen übernehmen": an entry
 * is not analysed afterwards. New quick entries are made on the food page (`/photo?form=1`); a link
 * without an entry goes there.
 */
export function QuickAddPage() {
  const { date, meal, entryId } = useSearch({ from: '/authed/quick-add' });
  const db = useDb();
  const entry = useLiveQuery(
    async () => (entryId ? ((await db.foodEntries.get(entryId)) ?? null) : null),
    [db, entryId],
  );
  if (entry === undefined) return null;
  if (!entry) return <Navigate to="/photo" search={{ date, meal, form: true }} replace />;
  return <QuickEntryEditor key={entry.id} entry={entry} />;
}

function QuickEntryEditor({ entry }: { entry: FoodEntry }) {
  const db = useDb();
  const navigate = useNavigate();
  const router = useRouter();
  const settings = useSettings();
  const [state, setState] = useState<QuickEntryState>(() => ({
    text: quickEntryText(entry),
    kcal: get(entry.nutrients, N.kcal),
    protein: entry.nutrients[N.protein] ?? null,
    carbs: entry.nutrients[N.carbs] ?? null,
    fat: entry.nutrients[N.fat] ?? null,
  }));
  const [meal, setMeal] = useState(entry.meal);
  const valid = quickEntryValid(state);
  /** Leaves the page of an entry that was changed or deleted: the page before, never this one again. */
  const leave = () =>
    goBackOr(
      router.history,
      1,
      () => void navigate({ to: '/', search: { date: entry.date }, replace: true }),
    );

  const { busy: saving, run } = useSubmitting();
  async function save() {
    if (!valid) return;
    await saveQuickEntry(db, entry, quickEntryValues(state, meal));
    toast.success('Änderungen übernommen');
    leave();
  }

  return (
    <Page
      title="Schnelleintrag bearbeiten"
      back
      withTabBar={false}
      footer={
        <Button size="lg" disabled={!valid || saving} onClick={() => void run(save)}>
          Änderungen übernehmen
        </Button>
      }
      actions={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Eintrag löschen"
          onClick={async () => {
            await deleteRecord(db, 'foodEntries', entry.id);
            toast('Eintrag gelöscht', {
              action: {
                label: 'Rückgängig',
                onClick: () => void restoreRecord(db, 'foodEntries', entry.id),
              },
            });
            leave();
          }}
        >
          <Trash2 className="text-destructive" aria-hidden />
        </Button>
      }
    >
      <Section>
        <div className="p-4">
          <QuickEntryFields
            value={state}
            onChange={setState}
            meal={{ value: meal, names: settings?.mealNames ?? [], onChange: setMeal }}
          />
        </div>
      </Section>
    </Page>
  );
}
