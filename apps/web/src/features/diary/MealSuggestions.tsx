import { get, N, sameMealName } from '@ft/shared';
import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import type { UserDb } from '@/db/dexie';
import { prepareMealTarget, type MealRef } from '@/db/diaryMeals';
import {
  copyMealFromDay,
  logSuggestion,
  type MealSuggestion,
  type MealSuggestions as MealSuggestionsData,
  type YesterdayMeal,
} from '@/db/suggestions';
import { deleteRecord } from '@/db/write';
import { useSubmitting } from '@/hooks/useSubmitting';
import { cn } from '@/lib/utils';
import { fmt0, fmtIngredients, fmtTime } from '@/lib/format';
import { entryAmountLabel } from './MealCard';

const undo = (db: UserDb, ids: string[]) => ({
  label: 'Rückgängig',
  onClick: () => void Promise.all(ids.map((id) => deleteRecord(db, 'foodEntries', id))),
});

/** "Wie gestern": logs the whole meal of the day before (`from`) into this meal, with undo. */
export async function copyYesterdayWithToast(
  db: UserDb,
  from: YesterdayMeal,
  into: MealRef,
  mealName: string,
): Promise<void> {
  const ids = await copyMealFromDay(db, from, await prepareMealTarget(db, into));
  if (ids.length === 0) return;
  const message = sameMealName(from.name, mealName)
    ? `${mealName} von gestern eingetragen`
    : `${from.name} von gestern in ${mealName} eingetragen`;
  toast(message, { action: undo(db, ids) });
}

/**
 * "Zuletzt hier" of a diary meal: what this meal usually gets (foods and groups, with the last amount)
 * without what it already has, below its entries. While the meal is `empty` "Wie gestern" (the whole
 * meal of the day before with the same name, else the nearest in time) comes first; with entries it is in the ⋯ menu. One tap logs it, with undo.
 */
export function MealSuggestions({
  target,
  mealName,
  data,
  empty,
}: {
  /** The meal the chips log into (`dm: 'new'` for the card of a day without meals). */
  target: MealRef;
  mealName: string;
  /** This meal's part of `useDaySuggestions` (undefined while loading). */
  data: MealSuggestionsData | undefined;
  /** No entries and no waiting analysis: offer "Wie gestern", no divider above. */
  empty: boolean;
}) {
  const db = useDb();
  const { busy, run } = useSubmitting();
  const yesterday = empty ? (data?.yesterday ?? null) : null;
  if (!data || (data.suggestions.length === 0 && !yesterday)) return null;

  const logOne = (s: MealSuggestion) =>
    run(async () => {
      const ids = await logSuggestion(db, s, await prepareMealTarget(db, target));
      toast(`„${s.name}“ in ${mealName} eingetragen`, { action: undo(db, ids) });
    });

  return (
    <div className={cn('px-4 pb-4', !empty && 'border-t border-border/70 pt-3')}>
      <p className="mb-2 text-xs text-muted-foreground">Zuletzt hier</p>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5" aria-label={`Zuletzt in ${mealName}`}>
        {yesterday && (
          <li className="shrink-0">
            <Chip
              title="Wie gestern"
              detail={`${yesterday.name} ${fmtTime(yesterday.eatenAt)} · ${fmt0(yesterday.kcal)} kcal`}
              icon={<History className="size-3.5 shrink-0" aria-hidden />}
              disabled={busy}
              onClick={() => void run(() => copyYesterdayWithToast(db, yesterday, target, mealName))}
            />
          </li>
        )}
        {data.suggestions.map((s) => {
          const kcal = s.items.reduce((sum, i) => sum + get(i.nutrients, N.kcal), 0);
          const amount =
            s.kind === 'food' && s.items[0] ? entryAmountLabel(s.items[0]) : fmtIngredients(s.items.length);
          return (
            <li key={s.key} className="shrink-0">
              <Chip
                title={s.name}
                detail={`${amount} · ${fmt0(kcal)} kcal`}
                disabled={busy}
                onClick={() => void logOne(s)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Chip({
  title,
  detail,
  icon,
  disabled,
  onClick,
}: {
  title: string;
  detail: string;
  icon?: ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={`${title}, ${detail}, eintragen`}
      className="grid h-11 max-w-44 min-w-0 content-center rounded-xl border border-border bg-background px-3 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
    >
      <span className="flex items-center gap-1 truncate text-sm font-medium">
        {icon}
        <span className="truncate">{title}</span>
      </span>
      <span className="tabular truncate text-[11px] text-muted-foreground">{detail}</span>
    </button>
  );
}
