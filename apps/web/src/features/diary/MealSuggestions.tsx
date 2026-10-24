import { addDays, get, N, type ISODate } from '@ft/shared';
import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { copyMealFromDay, logSuggestion, type MealSuggestion } from '@/db/suggestions';
import { deleteRecord } from '@/db/write';
import { useMealSuggestions } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmtIngredients } from '@/lib/format';
import { entryAmountLabel } from './MealCard';

/**
 * "Zuletzt hier" under an empty diary meal: what this meal usually gets (foods and groups, with the last
 * amount) and "Wie gestern" (the whole meal of the day before). One tap logs it, with undo. Nothing shows
 * while the meal has entries: adding more goes through "+".
 */
export function MealSuggestions({ date, meal, mealName }: { date: ISODate; meal: number; mealName: string }) {
  const db = useDb();
  const data = useMealSuggestions(date, meal);
  const { busy, run } = useSubmitting();
  if (!data || (data.suggestions.length === 0 && data.yesterdayKcal <= 0)) return null;

  const undo = (ids: string[]) => ({
    label: 'Rückgängig',
    onClick: () => void Promise.all(ids.map((id) => deleteRecord(db, 'foodEntries', id))),
  });
  const logOne = (s: MealSuggestion) =>
    run(async () => {
      const ids = await logSuggestion(db, s, { date, meal });
      toast(`„${s.name}“ in ${mealName} eingetragen`, { action: undo(ids) });
    });
  const copyYesterday = () =>
    run(async () => {
      const ids = await copyMealFromDay(db, { date: addDays(date, -1), meal }, { date, meal });
      toast(`${mealName} von gestern eingetragen`, { action: undo(ids) });
    });

  return (
    <div className="px-4 pb-4">
      <p className="mb-2 text-xs text-muted-foreground">Zuletzt hier</p>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5" aria-label={`Zuletzt in ${mealName}`}>
        {data.yesterdayKcal > 0 && (
          <li className="shrink-0">
            <Chip
              title="Wie gestern"
              detail={`${fmt0(data.yesterdayKcal)} kcal`}
              icon={<History className="size-3.5 shrink-0" aria-hidden />}
              disabled={busy}
              onClick={() => void copyYesterday()}
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
