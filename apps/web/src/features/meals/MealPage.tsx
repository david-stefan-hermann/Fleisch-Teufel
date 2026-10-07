import { get, N, sumNutrients, today } from '@ft/shared';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MacroSplitBar } from '@/components/MacroBars';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { deleteRecord, patchRecord, restoreRecord } from '@/db/write';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useSettings } from '@/hooks/data';
import { fmt0 } from '@/lib/format';
import { logItems } from './logMeal';

const FACTORS = [0.5, 1, 1.5, 2];

export function MealPage() {
  const { mealId } = useParams({ from: '/authed/meals/$mealId' });
  const search = useSearch({ from: '/authed/meals/$mealId' });
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const meal = useLiveQuery(async () => (await db.meals.get(mealId)) ?? null, [db, mealId]);
  const [name, setName] = useState<string | null>(null);
  const [factor, setFactor] = useState(1);
  const [target, setTarget] = useState(search.meal ?? 0);
  const date = search.date ?? today();

  if (meal === undefined) return null;
  if (!meal || meal.deleted) {
    return (
      <Page title="Meal" back withTabBar={false}>
        <EmptyState title="Meal nicht gefunden" />
      </Page>
    );
  }
  const totals = sumNutrients(meal.items.map((i) => i.nutrients));

  return (
    <Page
      title={meal.name}
      back
      withTabBar={false}
      actions={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Meal löschen"
          onClick={async () => {
            await deleteRecord(db, 'meals', meal.id);
            toast(`${meal.name} gelöscht`, {
              action: { label: 'Rückgängig', onClick: () => void restoreRecord(db, 'meals', meal.id) },
            });
            await navigate({ to: '/meals', search: { date: search.date, meal: search.meal } });
          }}
        >
          <Trash2 className="text-destructive" aria-hidden />
        </Button>
      }
    >
      <Section>
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="meal-name">Name</Label>
          <Input
            id="meal-name"
            autoComplete="off"
            value={name ?? meal.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const n = name?.trim();
              if (n && n !== meal.name) void patchRecord(db, 'meals', meal.id, { name: n });
              setName(null);
            }}
          />
        </div>
      </Section>
      <Section title={`${fmt0(get(totals, N.kcal))} kcal`}>
        <div className="px-4 pb-2">
          <MacroSplitBar
            protein={get(totals, N.protein)}
            carbs={get(totals, N.carbs)}
            fat={get(totals, N.fat)}
          />
        </div>
        <ul className="divide-y divide-border/70 pb-1">
          {meal.items.map((i, idx) => (
            <li key={idx} className="flex min-h-12 items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{i.name}</div>
                <div className="truncate text-xs text-muted-foreground">{entryAmountLabel(i)}</div>
              </div>
              <div className="tabular font-semibold">{fmt0(get(i.nutrients, N.kcal) * factor)}</div>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Eintragen">
        <div className="grid gap-4 px-4 pb-4">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Menge</span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={String(factor)}
              onValueChange={(v) => v && setFactor(Number(v))}
              className="w-full"
            >
              {FACTORS.map((f) => (
                <ToggleGroupItem key={f} value={String(f)} className="flex-1">
                  {f.toLocaleString('de-DE')}×
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="meal-target">Mahlzeit</Label>
            <Select value={String(target)} onValueChange={(v) => setTarget(Number(v))}>
              <SelectTrigger id="meal-target" className="w-full">
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
          <Button
            size="lg"
            onClick={async () => {
              const n = await logItems(db, meal.items, { date, meal: target }, { factor, mealId: meal.id });
              toast.success(`${meal.name}: ${n} Einträge hinzugefügt`);
              await navigate({ to: '/', search: { date } });
            }}
          >
            {fmt0(get(totals, N.kcal) * factor)} kcal eintragen
          </Button>
        </div>
      </Section>
    </Page>
  );
}
