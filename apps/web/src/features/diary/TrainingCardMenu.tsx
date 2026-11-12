import type { ExerciseEntry, ISODate } from '@ft/shared';
import { Copy, History, MoreHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyTrainingToClipboard, type TrainingPart } from '@/db/clipboard';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmtDate } from '@/lib/format';
import { logCopiesWithUndo, removeTrainingsWithUndo } from './ExerciseCard';

/**
 * The ⋯ menu of the training card, like a diary meal's: copy all trainings of the day (steps never) into
 * the clipboard, log yesterday's trainings again and delete all trainings of the day (with undo).
 */
export function TrainingCardMenu({
  date,
  trainings,
  yesterdayParts,
  weightKg,
}: {
  date: ISODate;
  /** The day's trainings without the steps. */
  trainings: readonly ExerciseEntry[];
  /** Yesterday's trainings as parts: "Wie gestern eintragen" only when there are some. */
  yesterdayParts: readonly TrainingPart[];
  /** Weight of the day: computed kcal of yesterday's trainings follow it. */
  weightKg: number;
}) {
  const db = useDb();
  const { busy, run } = useSubmitting();
  const empty = trainings.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Aktionen für Training">
          <MoreHorizontal className="size-5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem
          disabled={empty || busy}
          onSelect={() =>
            void run(async () => {
              const clip = await copyTrainingToClipboard(db, `Training ${fmtDate(date)}`, trainings);
              toast(`„${clip.name}“ kopiert`);
            })
          }
        >
          <Copy aria-hidden /> Kopieren
        </DropdownMenuItem>
        {yesterdayParts.length > 0 && (
          <DropdownMenuItem
            disabled={busy}
            onSelect={() =>
              void run(() =>
                logCopiesWithUndo(db, date, yesterdayParts, weightKg, 'Trainings von gestern eingetragen'),
              )
            }
          >
            <History aria-hidden /> Wie gestern eintragen
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={empty || busy}
          onSelect={() => void run(() => removeTrainingsWithUndo(db, trainings, 'Alle Trainings'))}
        >
          <Trash2 aria-hidden /> Alle Trainings löschen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
