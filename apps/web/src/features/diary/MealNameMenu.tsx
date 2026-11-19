import { sameMealName } from '@ft/shared';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MarqueeText } from '@/components/MarqueeText';
import { NameDialog } from '@/components/NameDialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { chooseMealName, ownMealNames, type DiaryDayMeal } from '@/db/diaryMeals';
import { DEFAULT_SETTINGS } from '@/db/settings';
import { useSettings } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';

/** The name of a diary meal in its card header: a tap offers the standard names, own ones and a new one. */
export function MealNameMenu({ meal }: { meal: DiaryDayMeal }) {
  const db = useDb();
  const settings = useSettings() ?? DEFAULT_SETTINGS;
  const { run, busy } = useSubmitting();
  const [ownOpen, setOwnOpen] = useState(false);
  const standard = settings.mealNames.filter(
    (name, i, all) => all.findIndex((n) => sameMealName(n, name)) === i,
  );
  const own = ownMealNames(settings);

  async function choose(name: string) {
    const { listed } = await chooseMealName(db, meal, name);
    if (!listed) toast('Die Auswahl ist voll. Der Name gilt nur für diese Mahlzeit.');
  }

  const option = (name: string) => (
    <DropdownMenuCheckboxItem
      key={name}
      className="min-h-11 data-[state=checked]:bg-accent"
      checked={sameMealName(name, meal.name)}
      disabled={busy}
      onSelect={() => void run(() => choose(name))}
    >
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </DropdownMenuCheckboxItem>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${meal.name}, Name ändern`}
          className="relative -mx-1.5 -my-0.5 max-w-full min-w-0 rounded-lg px-1.5 py-0.5 text-left font-semibold after:absolute after:inset-x-0 after:-inset-y-2 after:content-[''] hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none data-[state=open]:bg-accent"
        >
          <MarqueeText text={meal.name} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-59 max-w-[calc(100vw-2rem)]">
          {standard.map(option)}
          <DropdownMenuSeparator />
          {own.length > 0 && (
            <>
              {own.map(option)}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => setOwnOpen(true)}>
            <Pencil aria-hidden /> Eigener Name
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={ownOpen}
        onOpenChange={setOwnOpen}
        title="Eigener Name"
        confirmLabel="Speichern"
        defaultName=""
        maxLength={40}
        onConfirm={choose}
      />
    </>
  );
}
