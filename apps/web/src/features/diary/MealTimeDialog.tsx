import { addDays, canBeNight, eatenAtOf } from '@ft/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Wheel } from '@/components/Wheel';
import { setDiaryMealTime, type DiaryDayMeal } from '@/db/diaryMeals';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmtDayShort, fmtTime, fmtWeekdayShort } from '@/lib/format';

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, m) => String(m).padStart(2, '0'));

/** The time of a diary meal: hour and minute wheels, and for the small hours the night after its day. */
export function MealTimeDialog({
  meal,
  open,
  onOpenChange,
}: {
  meal: DiaryDayMeal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        {/* A new form per opening starts again from the meal's time. */}
        <MealTimeForm key={String(open)} meal={meal} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MealTimeForm({ meal, onClose }: { meal: DiaryDayMeal; onClose: () => void }) {
  const db = useDb();
  const { run, busy } = useSubmitting();
  const start = new Date(meal.eatenAt);
  const [hour, setHour] = useState(start.getHours());
  const [minute, setMinute] = useState(start.getMinutes());
  const [night, setNight] = useState(meal.night);
  const nightAllowed = canBeNight(hour);
  const eatenAt = eatenAtOf(meal.date, hour, minute, night && nightAllowed);
  const changed = eatenAt !== meal.eatenAt;

  const turnHour = (h: number) => {
    setHour(h);
    // From five o'clock on a time is on the meal's own day again.
    if (!canBeNight(h)) setNight(false);
  };

  async function apply() {
    const before = { eatenAt: meal.eatenAt, timeEdited: meal.timeEdited };
    await setDiaryMealTime(db, meal, eatenAt);
    onClose();
    toast(`${meal.name} auf ${fmtTime(eatenAt)} geändert`, {
      action: {
        label: 'Rückgängig',
        onClick: () => void setDiaryMealTime(db, meal, before.eatenAt, before.timeEdited),
      },
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-center">{meal.name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <TimeWheel label="Stunde" items={HOURS} index={hour} onTurn={turnHour} />
          <b className="text-xl" aria-hidden>
            :
          </b>
          <TimeWheel label="Minute" items={MINUTES} index={minute} onTurn={setMinute} />
        </div>
        {nightAllowed && (
          <ToggleGroup
            type="single"
            variant="outline"
            value={night ? 'night' : 'day'}
            onValueChange={(v) => v && setNight(v === 'night')}
            className="w-full rounded-lg"
          >
            <ToggleGroupItem value="day" className="h-10 flex-1">
              {fmtDayShort(meal.date)}
            </ToggleGroupItem>
            <ToggleGroupItem value="night" className="h-10 flex-1">
              Nacht auf {fmtWeekdayShort(addDays(meal.date, 1))}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button disabled={!changed || busy} onClick={() => void run(apply)}>
          Änderungen übernehmen
        </Button>
      </DialogFooter>
    </>
  );
}

function TimeWheel({
  label,
  items,
  index,
  onTurn,
}: {
  label: string;
  items: readonly string[];
  index: number;
  onTurn: (index: number) => void;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-x-0 top-11 h-11 rounded-lg bg-muted" aria-hidden />
      <Wheel
        label={label}
        items={items}
        index={index}
        onChange={onTurn}
        onSettle={onTurn}
        className="text-xl"
      />
    </div>
  );
}
