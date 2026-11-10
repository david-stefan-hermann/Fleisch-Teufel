import type { DaySummary, ExerciseEntry, FoodEntry, ISODate } from '@ft/shared';
import { Share } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSubmitting } from '@/hooks/useSubmitting';
import type { ShareParts } from './DayShareImage';
import {
  collectShareData,
  renderDayImage,
  shareDayFileName,
  shareImage,
  type ShareImageResult,
} from './shareDay';

export interface ShareDayDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: ISODate;
  summary: DaySummary;
  exerciseCredited: boolean;
  /** Setting "Schritte aufs Ziel anrechnen" (the steps row says "nicht angerechnet" when off). */
  stepsCredited?: boolean;
  mealNames: string[];
  entries: FoodEntry[];
  exercises: ExerciseEntry[];
  note: string;
}

/**
 * "Tag teilen": choose food (default), training and note, then the day goes to the share sheet as a
 * picture (`renderDayImage`). The choice is not kept. Training and note are disabled when the day
 * has none.
 */
export function ShareDayDialog({ open, onOpenChange, ...props }: ShareDayDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* A new form per opening starts again from the defaults. */}
        <ShareDayForm key={String(open)} {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ShareDayForm({
  onClose,
  ...data
}: Omit<ShareDayDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const db = useDb();
  const { run, busy } = useSubmitting();
  const hasTraining = data.exercises.length > 0;
  const hasNote = data.note.trim().length > 0;
  const [parts, setParts] = useState<ShareParts>({ food: true, training: false, note: false });
  // The picture is ready but the share sheet wants a fresh tap (iOS after a long rasterizing).
  const [ready, setReady] = useState<File | null>(null);
  const chosen = {
    food: parts.food,
    training: parts.training && hasTraining,
    note: parts.note && hasNote,
  };
  const none = !chosen.food && !chosen.training && !chosen.note;

  function finish(result: ShareImageResult, file: File) {
    if (result === 'needs-tap') {
      setReady(file);
      return;
    }
    if (result === 'downloaded') toast.success('Bild erstellt');
    if (result !== 'aborted') onClose();
  }

  function share() {
    void run(async () => {
      if (ready) {
        finish(await shareImage(ready), ready);
        return;
      }
      const full = await collectShareData(db, { ...data, parts: chosen });
      const blob = await renderDayImage(full);
      const file = new File([blob], shareDayFileName(data.date), { type: 'image/png' });
      finish(await shareImage(file), file);
    });
  }

  const set = (key: keyof ShareParts) => (v: boolean | 'indeterminate') => {
    setReady(null);
    setParts((p) => ({ ...p, [key]: v === true }));
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Tag teilen</DialogTitle>
        <DialogDescription>Als Bild, wie ein Screenshot des Tages.</DialogDescription>
      </DialogHeader>
      <DialogBody className="gap-1">
        <PartRow label="Essen" checked={parts.food} onChange={set('food')} />
        <PartRow
          label="Training"
          checked={chosen.training}
          onChange={set('training')}
          disabledHint={hasTraining ? undefined : 'Kein Training eingetragen'}
        />
        <PartRow
          label="Notiz"
          checked={chosen.note}
          onChange={set('note')}
          disabledHint={hasNote ? undefined : 'Keine Notiz'}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button onClick={share} disabled={none || busy}>
          {busy ? (
            'Bild wird erstellt …'
          ) : (
            <>
              <Share aria-hidden /> {ready ? 'Bild teilen' : 'Teilen'}
            </>
          )}
        </Button>
      </DialogFooter>
    </>
  );
}

function PartRow({
  label,
  checked,
  onChange,
  disabledHint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean | 'indeterminate') => void;
  disabledHint?: string;
}) {
  const id = useId();
  const disabled = !!disabledHint;
  return (
    <div className="flex min-h-11 items-center gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      <label
        htmlFor={id}
        className={disabled ? 'text-sm font-medium opacity-50' : 'cursor-pointer text-sm font-medium'}
      >
        {label}
        {disabledHint && (
          <span className="block text-xs font-normal text-muted-foreground">{disabledHint}</span>
        )}
      </label>
    </div>
  );
}
