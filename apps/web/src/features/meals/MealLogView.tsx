import { get, N, rescaleItem, sumNutrients, targetsForDate, type Meal } from '@ft/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { NutrientBreakdown } from '@/components/NutrientBreakdown';
import { Page, Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { useGoals, useSettings } from '@/hooks/data';
import { fmt0, fmtFixed, fmtIngredients } from '@/lib/format';
import { logItems } from './logMeal';

const FACTOR_MIN = 0.5;
const FACTOR_MAX = 2;

/**
 * Logging a saved meal (food search, tab "Eigene"): its ingredients read-only, a swipe leaves one
 * out of this entry only, the amount goes from 0,5× to 2×. "Meal bearbeiten" opens the editor.
 */
export function MealLogView({ meal, date, mealIndex }: { meal: Meal; date: string; mealIndex: number }) {
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const goals = useGoals();
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());
  const [factor, setFactor] = useState(1);
  const [target, setTarget] = useState(mealIndex);

  const kept = meal.items.filter((_, i) => !excluded.has(i));
  // Same rounding as `logItems`, so the button shows what gets logged.
  const scaled = kept.map((it) =>
    factor === 1 ? it : rescaleItem(it, Math.round(it.quantity * factor * 1000) / 1000),
  );
  const totals = sumNutrients(scaled.map((i) => i.nutrients));
  const kcal = get(totals, N.kcal);
  const left = meal.items.filter((_, i) => excluded.has(i));

  function exclude(index: number) {
    if (kept.length <= 1) {
      toast.error('Mindestens eine Zutat bleibt.');
      return;
    }
    setExcluded((s) => new Set(s).add(index));
    toast(`${meal.items[index]!.name} entfernt`, {
      action: {
        label: 'Rückgängig',
        onClick: () =>
          setExcluded((s) => {
            const next = new Set(s);
            next.delete(index);
            return next;
          }),
      },
    });
  }

  async function log() {
    const n = await logItems(db, kept, { date, meal: target }, { factor, mealId: meal.id });
    toast.success(`${meal.name}: ${fmtIngredients(n)} eingetragen`);
    await navigate({ to: '/', search: { date } });
  }

  return (
    <Page
      title={meal.name}
      back
      withTabBar={false}
      footer={
        <Button size="lg" onClick={() => void log()}>
          {fmt0(kcal)} kcal eintragen
        </Button>
      }
    >
      {meal.photoId && (
        <div className="mb-4 overflow-hidden rounded-2xl border border-border/70">
          <MealPhoto photoId={meal.photoId} alt={`Foto von ${meal.name}`} className="aspect-[4/3] w-full" />
        </div>
      )}
      <Section title="Zutaten">
        <ul className="divide-y divide-border/70 border-t border-border/70">
          {meal.items.map((it, i) =>
            excluded.has(i) ? null : (
              <li key={i}>
                <SwipeToDelete label={`${it.name} für diesen Eintrag entfernen`} onDelete={() => exclude(i)}>
                  <div className="flex min-h-12 items-center gap-3 px-4 py-2 select-none">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{it.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{entryAmountLabel(it)}</div>
                    </div>
                    <div className="tabular font-semibold">{fmt0(get(it.nutrients, N.kcal))}</div>
                  </div>
                </SwipeToDelete>
              </li>
            ),
          )}
        </ul>
        <div className="grid gap-2 border-t border-border/70 px-4 py-3">
          {left.length > 0 && (
            <p className="text-xs text-muted-foreground text-pretty">
              Ohne {left.map((it) => it.name).join(', ')}. Das gespeicherte Meal bleibt unverändert.
            </p>
          )}
          <Link
            to="/meals/$mealId"
            params={{ mealId: meal.id }}
            className="justify-self-start text-sm font-medium text-primary underline underline-offset-2"
          >
            Meal bearbeiten
          </Link>
        </div>
      </Section>
      <Section title="Nährwerte">
        <NutrientBreakdown
          className="px-4 pb-3"
          nutrients={totals}
          targets={targetsForDate(goals ?? [], date)}
        />
      </Section>
      <Section title="Eintragen">
        <div className="grid gap-4 px-4 pb-4">
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="meal-factor">Menge</Label>
              <output htmlFor="meal-factor" className="tabular text-lg font-semibold">
                {fmtFixed(factor, 1)}×
              </output>
            </div>
            <Slider
              id="meal-factor"
              aria-label="Menge"
              aria-valuetext={`${fmtFixed(factor, 1)}-fach`}
              min={FACTOR_MIN}
              max={FACTOR_MAX}
              step={0.1}
              value={[factor]}
              onValueChange={([v]) => v !== undefined && setFactor(Math.round(v * 10) / 10)}
            />
            <div className="relative h-4 text-xs text-muted-foreground" aria-hidden>
              <span className="absolute left-0">0,5×</span>
              <span
                className="absolute -translate-x-1/2"
                style={{ left: `${((1 - FACTOR_MIN) / (FACTOR_MAX - FACTOR_MIN)) * 100}%` }}
              >
                1×
              </span>
              <span className="absolute right-0">2×</span>
            </div>
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
        </div>
      </Section>
    </Page>
  );
}
