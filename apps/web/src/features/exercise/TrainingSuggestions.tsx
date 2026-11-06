import { DEFAULT_WEIGHT_KG, trainingSummary, type ISODate } from '@ft/shared';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { logTrainings } from '@/db/entries';
import type { TrainingSuggestion } from '@/db/trainingSuggestions';
import { deleteRecord } from '@/db/write';
import { useCurrentWeight, useTrainingHistory } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';
import { describeValues, missingSportsText, rowsToLog, useTypeOptions } from './training';
import { ChipRow, TrainingChip } from './TrainingChips';

/**
 * "Zuletzt & häufig" under the diary's training card: pinned saved trainings first, then the sports
 * (values of the last time) and saved trainings (their saved activities) this person logs, without
 * what the day already has. One tap logs it (all activities of a saved training as one group, kcal
 * from the weight of the day), with undo. Nothing while there is nothing to suggest.
 */
export function TrainingSuggestions({
  date,
  className,
  leading,
}: {
  date: ISODate;
  className?: string;
  /** Chips before the suggestions ("Wie gestern"). */
  leading?: ReactNode;
}) {
  const db = useDb();
  const history = useTrainingHistory(date);
  const options = useTypeOptions();
  const weight = useCurrentWeight(date);
  const { busy, run } = useSubmitting();
  const suggestions = (history?.suggestions ?? []).filter((s) =>
    s.items.some((i) => options.some((o) => o.key === i.typeKey)),
  );
  if (suggestions.length === 0 && !leading) return null;

  const logOne = (s: TrainingSuggestion) =>
    run(async () => {
      const { rows, missing } = rowsToLog(options, s.items, weight ?? DEFAULT_WEIGHT_KG, s.templateId);
      if (missing.length) toast.error(missingSportsText(missing));
      if (rows.length === 0) return;
      const ids = await logTrainings(db, date, rows);
      const kcal = rows.reduce((sum, r) => sum + r.kcal, 0);
      toast(`„${s.title}“ eingetragen: ${fmt0(kcal)} kcal`, {
        action: {
          label: 'Rückgängig',
          onClick: () => void Promise.all(ids.map((id) => deleteRecord(db, 'exerciseEntries', id))),
        },
      });
    });

  return (
    <div className={cn('px-4 pb-4', className)}>
      <ChipRow caption="Zuletzt & häufig" label="Zuletzt und häufig eingetragene Trainings">
        {leading}
        {suggestions.map((s) => {
          const detail = suggestionDetail(s);
          return (
            <li key={s.key} className="shrink-0">
              <TrainingChip
                title={s.title}
                detail={detail}
                saved={!!s.templateId}
                pinned={s.pinned}
                disabled={busy}
                ariaLabel={`${s.title}, ${detail}, eintragen`}
                onClick={() => void logOne(s)}
              />
            </li>
          );
        })}
      </ChipRow>
    </div>
  );
}

/** The line under a suggestion: the sports and the duration (a sport: duration and intensity). */
export function suggestionDetail(s: Pick<TrainingSuggestion, 'templateId' | 'items'>): string {
  if (s.templateId) return trainingSummary(s.items.map((i) => ({ typeName: i.name, minutes: i.minutes })));
  return describeValues(s.items[0]!);
}
