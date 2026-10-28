import {
  DEFAULT_WEIGHT_KG,
  INTENSITY_LABELS_DE,
  metFor,
  netExerciseKcal,
  round,
  type ISODate,
} from '@ft/shared';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { logTrainings } from '@/db/entries';
import type { TrainingSuggestion } from '@/db/trainingSuggestions';
import { deleteRecord } from '@/db/write';
import { useCurrentWeight, useTrainingHistory } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0 } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTypeOptions } from './training';
import { ChipRow, TrainingChip } from './TrainingChips';

/**
 * "Zuletzt & häufig" under the diary's training card: the sports this person logs, with the values
 * of the last time, without what the day already has. One tap logs it (kcal from the weight of the
 * day), with undo. Nothing while there is no training in the last weeks.
 */
export function TrainingSuggestions({ date, className }: { date: ISODate; className?: string }) {
  const db = useDb();
  const history = useTrainingHistory(date);
  const options = useTypeOptions();
  const weight = useCurrentWeight(date);
  const { busy, run } = useSubmitting();
  const suggestions = (history?.suggestions ?? []).filter((s) => options.some((o) => o.key === s.typeKey));
  if (suggestions.length === 0) return null;

  const logOne = (s: TrainingSuggestion) =>
    run(async () => {
      const type = options.find((o) => o.key === s.typeKey);
      if (!type) return;
      const met = metFor(type, s.intensity);
      const weightKg = weight ?? DEFAULT_WEIGHT_KG;
      const kcal = round(netExerciseKcal(met, weightKg, s.minutes), 0);
      const [id] = await logTrainings(db, date, [
        {
          typeKey: type.key,
          name: type.name,
          minutes: s.minutes,
          intensity: s.intensity,
          met,
          weightKg,
          kcal,
          note: s.note,
        },
      ]);
      toast(`${type.name} eingetragen: ${fmt0(kcal)} kcal`, {
        action: { label: 'Rückgängig', onClick: () => void deleteRecord(db, 'exerciseEntries', id!) },
      });
    });

  return (
    <div className={cn('px-4 pb-4', className)}>
      <ChipRow caption="Zuletzt & häufig" label="Zuletzt und häufig eingetragene Trainings">
        {suggestions.map((s) => {
          const detail = `${fmt0(s.minutes)} Min. · ${INTENSITY_LABELS_DE[s.intensity]}`;
          return (
            <li key={s.typeKey} className="shrink-0">
              <TrainingChip
                title={s.name}
                detail={detail}
                disabled={busy}
                ariaLabel={`${s.name}, ${detail}, eintragen`}
                onClick={() => void logOne(s)}
              />
            </li>
          );
        })}
      </ChipRow>
    </div>
  );
}
