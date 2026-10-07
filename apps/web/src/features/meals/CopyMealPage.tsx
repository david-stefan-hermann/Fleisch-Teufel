import { addDays, get, N, sumNutrients } from '@ft/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { EmptyState, Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useSettings } from '@/hooks/data';
import { fmt0, fmtDayLong } from '@/lib/format';
import { logItems } from './logMeal';

/** Copy a meal from another day (default: same meal yesterday) into the target meal. */
export function CopyMealPage() {
  const { date, meal } = useSearch({ from: '/authed/copy-meal' });
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const [sourceDate, setSourceDate] = useState(addDays(date, -1));
  const [sourceMeal, setSourceMeal] = useState(meal);
  const entries = useLiveQuery(
    () =>
      db.foodEntries
        .where('[date+meal]')
        .equals([sourceDate, sourceMeal])
        .filter((e) => !e.deleted)
        .sortBy('loggedAt'),
    [db, sourceDate, sourceMeal],
  );
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const chosen = entries?.filter((e) => selected === null || selected.has(e.id)) ?? [];
  const total = get(sumNutrients(chosen.map((e) => e.nutrients)), N.kcal);
  const names = settings?.mealNames ?? [];

  return (
    <Page title={`Nach ${names[meal] ?? ''} kopieren`} back withTabBar={false}>
      <Section>
        <div className="grid grid-cols-2 items-start gap-3 p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="src-date">Von Tag</Label>
            <Input
              id="src-date"
              type="date"
              value={sourceDate}
              onChange={(e) => {
                if (e.target.value) setSourceDate(e.target.value);
                setSelected(null);
              }}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="src-meal">Mahlzeit</Label>
            <Select
              value={String(sourceMeal)}
              onValueChange={(v) => {
                setSourceMeal(Number(v));
                setSelected(null);
              }}
            >
              <SelectTrigger id="src-meal" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {names.map((n, i) => (
                  <SelectItem key={i} value={String(i)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex flex-wrap gap-2">
            {[-1, -2, -7].map((d) => (
              <Button
                key={d}
                variant={sourceDate === addDays(date, d) ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => {
                  setSourceDate(addDays(date, d));
                  setSelected(null);
                }}
              >
                {d === -1 ? 'Gestern' : d === -2 ? 'Vorgestern' : 'Vor einer Woche'}
              </Button>
            ))}
          </div>
        </div>
      </Section>
      <Section title={fmtDayLong(sourceDate)}>
        {entries?.length === 0 ? (
          <EmptyState title="Keine Einträge in dieser Mahlzeit" />
        ) : (
          <ul className="divide-y divide-border/70 pb-1">
            {entries?.map((e) => {
              const on = selected === null || selected.has(e.id);
              return (
                <li key={e.id}>
                  <label className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2 hover:bg-accent/60">
                    <input
                      type="checkbox"
                      className="size-5 accent-[var(--primary)]"
                      checked={on}
                      onChange={() => {
                        const next = new Set(selected ?? entries.map((x) => x.id));
                        if (on) next.delete(e.id);
                        else next.add(e.id);
                        setSelected(next);
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{entryAmountLabel(e)}</div>
                    </div>
                    <span className="tabular font-semibold">{fmt0(get(e.nutrients, N.kcal))}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Button
        size="lg"
        className="w-full"
        disabled={chosen.length === 0}
        onClick={async () => {
          const items = chosen.map(
            ({
              foodId,
              source,
              name,
              brand,
              grams,
              portionLabel,
              portionGrams,
              quantity,
              per100,
              nutrients,
            }) => ({
              foodId,
              source,
              name,
              brand,
              grams,
              portionLabel,
              portionGrams,
              quantity,
              per100,
              nutrients,
            }),
          );
          await logItems(db, items, { date, meal });
          toast.success(`${chosen.length} Einträge kopiert`);
          await navigate({ to: '/', search: { date } });
        }}
      >
        <Copy aria-hidden /> {chosen.length} Einträge kopieren ({fmt0(total)} kcal)
      </Button>
    </Page>
  );
}
