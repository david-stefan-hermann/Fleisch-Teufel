import { ChevronDown, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MealPick } from '@/db/diaryMeals';
import { useMealChoice } from '@/hooks/data';
import { fmtTime } from '@/lib/format';
import { mealOptions } from '@/lib/meals';

/**
 * The diary meal a page logs into, at the right end of its header (`Page actions`): the name and
 * below it the time, or "Neu" for a meal that begins with this entry. A tap opens the meals of the
 * day and "Neue Mahlzeit" with the name it would get.
 */
export function HeaderMealPicker({
  date,
  meal,
  dm,
  onChange,
  disabled,
}: {
  date: string;
  meal: number;
  dm?: string;
  onChange: (pick: MealPick) => void;
  disabled?: boolean;
}) {
  const choice = useMealChoice(date, meal, dm);
  // Still loading: no meal to name yet.
  if (!choice) return null;
  const { current } = choice;
  const { meals, next } = mealOptions(choice);
  const pick = (value: string) => {
    const option = [...meals, next].find((o) => o.value === value);
    if (option) onChange(option.pick);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label={`Mahlzeit: ${current.name}`}
          className="h-11 max-w-[45vw] gap-1 px-2 font-normal has-[>svg]:px-2"
        >
          <span className="flex min-w-0 flex-col items-end leading-tight">
            <span className="max-w-full truncate text-sm font-medium">{current.name}</span>
            {current.eatenAt === null ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[11px]">
                Neu
              </Badge>
            ) : (
              <span className="tabular text-xs text-muted-foreground">{fmtTime(current.eatenAt)}</span>
            )}
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[80vw] min-w-56">
        <DropdownMenuRadioGroup value={current.id} onValueChange={pick}>
          {meals.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="min-h-11">
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
              <span className="tabular shrink-0 text-xs text-muted-foreground">{o.detail}</span>
            </DropdownMenuRadioItem>
          ))}
          {meals.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuRadioItem value={next.value} className="min-h-11">
            <Plus className="size-4" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{next.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{next.detail}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
