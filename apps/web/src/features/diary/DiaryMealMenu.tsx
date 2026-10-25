import type { FoodEntry, ISODate } from '@ft/shared';
import { Copy, History, MoreHorizontal, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NameDialog } from '@/components/NameDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { saveMealFromEntries } from '@/db/entries';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { saveMealDescription } from './ClipboardMenu';
import { copyMealWithToast, removeEntriesWithUndo } from './MealCard';
import { copyYesterdayWithToast } from './MealSuggestions';

/**
 * The ⋯ menu of a diary meal (card header in the diary and `/diary-meal`): copy the whole meal into the
 * clipboard, save it as a reusable meal (every ingredient on its own), log yesterday's meal again and
 * delete all its entries (with undo). Waiting analyses are not entries and stay out of all of it.
 */
export function DiaryMealMenu({
  date,
  meal,
  mealName,
  entries,
  yesterdayKcal,
  iconClassName = 'size-5',
}: {
  date: ISODate;
  meal: number;
  mealName: string;
  entries: readonly FoodEntry[];
  /** kcal of this meal yesterday: "Wie gestern eintragen" only when something is there. */
  yesterdayKcal: number;
  /** Icon size: 20 px in a card header; page headers pass '' and get their 24 px. */
  iconClassName?: string;
}) {
  const db = useDb();
  const { busy, run } = useSubmitting();
  const [saveOpen, setSaveOpen] = useState(false);
  const empty = entries.length === 0;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Aktionen für ${mealName}`}>
            <MoreHorizontal className={cn(iconClassName, 'text-muted-foreground')} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem
            disabled={empty || busy}
            onSelect={() => void run(() => copyMealWithToast(db, mealName, entries))}
          >
            <Copy aria-hidden /> Kopieren
          </DropdownMenuItem>
          <DropdownMenuItem disabled={empty} onSelect={() => setSaveOpen(true)}>
            <Save aria-hidden /> Als Meal speichern
          </DropdownMenuItem>
          {yesterdayKcal > 0 && (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => void run(() => copyYesterdayWithToast(db, date, meal, mealName))}
            >
              <History aria-hidden /> Wie gestern eintragen
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={empty || busy}
            onSelect={() => void run(() => removeEntriesWithUndo(db, [...entries], `${mealName} geleert`))}
          >
            <Trash2 aria-hidden /> Alle Einträge löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Als Meal speichern"
        description={saveMealDescription(entries.length)}
        confirmLabel="Meal speichern"
        defaultName={`${mealName} ${fmtDate(date)}`}
        placeholder="z. B. Mein Mittagessen…"
        onConfirm={async (name) => {
          await saveMealFromEntries(db, name, entries);
          toast.success(`„${name}“ gespeichert`);
        }}
      />
    </>
  );
}
