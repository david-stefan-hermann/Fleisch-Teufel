import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { errorMessage } from '@/lib/api';

export type SaveTrainingMode = 'update' | 'new';

export interface SaveTrainingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved training this comes from: offers "„…“ aktualisieren" (preselected) next to a new one. */
  existing?: { name: string } | null;
  /** Prefilled name for a new training. */
  defaultName: string;
  /** Called with the trimmed name (for an update: the existing one); the dialog closes once it resolves. */
  onConfirm: (name: string, mode: SaveTrainingMode) => Promise<void> | void;
}

/**
 * "Als Training speichern" of "Training eintragen": updates the saved training it comes from
 * (preselected) or saves the activities as a new one with a name (pattern of `SaveMealDialog`).
 */
export function SaveTrainingDialog({ open, onOpenChange, ...props }: SaveTrainingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <SaveTrainingForm key={String(open)} {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function SaveTrainingForm({
  existing,
  defaultName,
  onConfirm,
  onClose,
}: Omit<SaveTrainingDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const id = useId();
  const [mode, setMode] = useState<SaveTrainingMode>(existing ? 'update' : 'new');
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const valid = mode === 'update' || name.trim().length > 0;
  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm(mode === 'update' && existing ? existing.name : name.trim(), mode);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Als Training speichern</DialogTitle>
        {mode === 'update' && existing && (
          <DialogDescription>
            Die Aktivitäten, wie sie hier stehen, ersetzen die von „{existing.name}“. Bereits eingetragene
            Trainings bleiben, wie sie sind.
          </DialogDescription>
        )}
      </DialogHeader>
      <DialogBody className="gap-4">
        {existing && (
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as SaveTrainingMode)}
            aria-label="Speichern als"
            className="gap-1"
          >
            <Label className="flex min-h-11 items-center gap-3 font-normal">
              <RadioGroupItem value="update" />
              <span className="min-w-0">„{existing.name}“ aktualisieren</span>
            </Label>
            <Label className="flex min-h-11 items-center gap-3 font-normal">
              <RadioGroupItem value="new" /> Als neues Training speichern
            </Label>
          </RadioGroup>
        )}
        {mode === 'new' && (
          <div className="grid gap-1.5">
            <Label htmlFor={id}>Name</Label>
            <Input
              id={id}
              value={name}
              maxLength={80}
              autoFocus
              autoComplete="off"
              enterKeyHint="done"
              placeholder="z. B. Gym-Besuch…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirm();
                }
              }}
            />
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button disabled={!valid || busy} onClick={() => void confirm()}>
          Speichern
        </Button>
      </DialogFooter>
    </>
  );
}
