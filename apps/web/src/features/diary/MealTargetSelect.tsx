import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { MealPick } from '@/db/diaryMeals';
import { useMealChoice } from '@/hooks/data';
import { mealOptions, type MealOption } from '@/lib/meals';

function OptionRow({ option }: { option: MealOption }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{option.name}</span>
      <span className="tabular shrink-0 text-xs text-muted-foreground">{option.detail}</span>
    </span>
  );
}

/** "Mahlzeit" of a form: the meals of the day with their time, then a new one with the name it would get. */
export function MealTargetSelect({
  id,
  date,
  meal,
  dm,
  onChange,
}: {
  id: string;
  date: string;
  meal: number;
  dm?: string;
  onChange: (pick: MealPick) => void;
}) {
  const choice = useMealChoice(date, meal, dm);
  if (!choice) return null;
  const { meals, next } = mealOptions(choice);
  const options = [...meals, next];
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Mahlzeit</Label>
      <Select
        value={choice.current.id}
        onValueChange={(value) => {
          const option = options.find((o) => o.value === value);
          if (option) onChange(option.pick);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <OptionRow option={o} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
