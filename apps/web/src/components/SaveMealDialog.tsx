import { useState } from 'react';
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
import { fmt0 } from '@/lib/format';

export type SaveMealMode = 'new' | 'update';

export interface SaveMealDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Number of ingredients that go into the meal. */
  count: number;
  /** Prefilled name for a new meal. */
  defaultName: string;
  /** The saved meal this comes from: offers "„…“ aktualisieren" next to a new meal. */
  existing?: { name: string } | null;
  /** The editor has changes that saving takes over too (group editor). */
  dirty?: boolean;
  /** Called with the trimmed name; the dialog closes once it resolves. */
  onConfirm: (name: string, mode: SaveMealMode) => Promise<void> | void;
}

/**
 * "Als Meal speichern" of a diary meal, a copied meal and a diary group: asks for the name; for a group
 * logged from a saved meal also whether it becomes a new meal (default) or updates that one.
 */
export function SaveMealDialog({ open, onOpenChange, ...props }: SaveMealDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* A new form per opening starts again from the default name. */}
        <SaveMealForm key={String(open)} {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function SaveMealForm({
  count,
  defaultName,
  existing,
  dirty,
  onConfirm,
  onClose,
}: Omit<SaveMealDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [mode, setMode] = useState<SaveMealMode>('new');
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length > 0;
  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm(name.trim(), mode);
      onClose();
    } catch (e) {
      // Stays open with the typed name, so nothing is lost.
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function pick(next: SaveMealMode) {
    setMode(next);
    // Updating keeps the meal's name unless the person types another one.
    if (existing) setName(next === 'update' ? existing.name : defaultName);
  }
  const description = [
    count === 1
      ? '1 Zutat wird als wiederverwendbares Meal gespeichert.'
      : `Alle ${fmt0(count)} Zutaten werden einzeln als wiederverwendbares Meal gespeichert.`,
    dirty && 'Übernimmt auch deine Änderungen an diesem Eintrag.',
    mode === 'update' && 'Bereits eingetragene Tage bleiben, wie sie sind.',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      <DialogHeader>
        <DialogTitle>Als Meal speichern</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogBody className="gap-4">
        {existing && (
          <RadioGroup
            value={mode}
            onValueChange={(v) => pick(v as SaveMealMode)}
            aria-label="Speichern als"
            className="gap-1"
          >
            <Label className="flex min-h-11 items-center gap-3 font-normal">
              <RadioGroupItem value="new" /> Als neues Meal speichern
            </Label>
            <Label className="flex min-h-11 items-center gap-3 font-normal">
              <RadioGroupItem value="update" />
              <span className="min-w-0">„{existing.name}“ aktualisieren</span>
            </Label>
          </RadioGroup>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="save-meal-name">Name</Label>
          <Input
            id="save-meal-name"
            value={name}
            maxLength={120}
            autoFocus={!existing}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="z. B. Mein Mittagessen…"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void confirm();
              }
            }}
          />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button disabled={!valid || busy} onClick={() => void confirm()}>
          Meal speichern
        </Button>
      </DialogFooter>
    </>
  );
}
