import { get, kcalFromMacros, N, quickAddNutrients, uuidv7, type FoodEntry } from '@ft/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { deleteRecord, restoreRecord, saveRecord } from '@/db/write';
import { useSettings } from '@/hooks/data';
import { fmt0 } from '@/lib/format';

/** Quick add (feature #4): kcal plus optional macros, no food. */
export function QuickAddPage() {
  const { date, meal, entryId } = useSearch({ from: '/authed/quick-add' });
  const db = useDb();
  const entry = useLiveQuery(
    async () => (entryId ? ((await db.foodEntries.get(entryId)) ?? null) : null),
    [db, entryId],
  );
  if (entry === undefined) return null;
  return <QuickAddForm key={entry?.id ?? 'new'} date={date} defaultMeal={meal} entry={entry} />;
}

function QuickAddForm({
  date,
  defaultMeal,
  entry,
}: {
  date: string;
  defaultMeal: number;
  entry: FoodEntry | null;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const [name, setName] = useState(entry?.name ?? 'Schnell hinzugefügt');
  const [kcal, setKcal] = useState<number | null>(entry ? get(entry.nutrients, N.kcal) : null);
  const [protein, setProtein] = useState<number | null>(entry?.nutrients[N.protein] ?? null);
  const [carbs, setCarbs] = useState<number | null>(entry?.nutrients[N.carbs] ?? null);
  const [fat, setFat] = useState<number | null>(entry?.nutrients[N.fat] ?? null);
  const [meal, setMeal] = useState(entry?.meal ?? defaultMeal);

  const macroKcal = kcalFromMacros({ proteinG: protein ?? 0, carbsG: carbs ?? 0, fatG: fat ?? 0 });
  const valid = kcal !== null && kcal >= 0 && kcal < 20_000;

  async function save() {
    if (!valid) return;
    const nutrients = quickAddNutrients({
      kcal: kcal!,
      proteinG: protein ?? undefined,
      carbsG: carbs ?? undefined,
      fatG: fat ?? undefined,
    });
    const base = {
      source: 'quick' as const,
      foodId: null,
      name: name.trim() || 'Schnell hinzugefügt',
      brand: null,
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients,
      meal,
      mealId: null,
      aiAnalysisId: null,
    };
    if (entry) await saveRecord(db, 'foodEntries', { ...entry, ...base });
    else
      await saveRecord(db, 'foodEntries', {
        ...base,
        id: uuidv7(),
        date,
        loggedAt: Date.now(),
        groupId: null,
      });
    toast.success(`${fmt0(kcal!)} kcal eingetragen`);
    await navigate({ to: '/', search: { date: entry?.date ?? date } });
  }

  return (
    <Page
      title={entry ? 'Schnelleintrag bearbeiten' : 'Schnell hinzufügen'}
      back
      withTabBar={false}
      actions={
        entry ? (
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
              await navigate({ to: '/', search: { date: entry.date } });
            }}
          >
            <Trash2 className="text-destructive" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <Section>
        <form
          className="grid gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="qa-name">Bezeichnung</Label>
            <Input id="qa-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <NumberField label="Kalorien" unit="kcal" value={kcal} onValueChange={setKcal} integer />
          <div className="grid grid-cols-3 gap-3">
            <NumberField label="Protein" unit="g" value={protein} onValueChange={setProtein} />
            <NumberField label="Kohlenh." unit="g" value={carbs} onValueChange={setCarbs} />
            <NumberField label="Fett" unit="g" value={fat} onValueChange={setFat} />
          </div>
          {macroKcal > 0 && (
            <p className="text-xs text-muted-foreground">
              Makros ergeben ≈ {fmt0(macroKcal)} kcal.{' '}
              {kcal === null && (
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => setKcal(Math.round(macroKcal))}
                >
                  Übernehmen
                </button>
              )}
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="qa-meal">Mahlzeit</Label>
            <Select value={String(meal)} onValueChange={(v) => setMeal(Number(v))}>
              <SelectTrigger id="qa-meal" className="w-full">
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
          <Button type="submit" size="lg" disabled={!valid}>
            {entry ? 'Änderungen speichern' : 'Eintragen'}
          </Button>
        </form>
      </Section>
    </Page>
  );
}
