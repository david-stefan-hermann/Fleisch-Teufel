import { useState, type ReactNode } from 'react';
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
import { errorMessage } from '@/lib/api';

export interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Confirm button, e.g. "Meal speichern". */
  confirmLabel: string;
  /** Prefilled name, used again each time the dialog opens. */
  defaultName: string;
  maxLength?: number;
  placeholder?: string;
  /** Called with the trimmed name; the dialog closes once it resolves. */
  onConfirm: (name: string) => Promise<void> | void;
}

/**
 * Asks for a name before something is saved for reuse ("Als Meal speichern", "Als Training
 * speichern"). Enter confirms; an empty name cannot be confirmed.
 */
export function NameDialog({ open, onOpenChange, ...props }: NameDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* A new form per opening starts again from the default name. */}
        <NameForm key={String(open)} {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NameForm({
  title,
  description,
  confirmLabel,
  defaultName,
  maxLength = 120,
  placeholder,
  onConfirm,
  onClose,
}: Omit<NameDialogProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length > 0;
  async function confirm() {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await onConfirm(name.trim());
      onClose();
    } catch (e) {
      // Stays open with the typed name, so nothing is lost.
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogBody className="gap-1.5">
        <Label htmlFor="name-dialog-name">Name</Label>
        <Input
          id="name-dialog-name"
          value={name}
          maxLength={maxLength}
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          placeholder={placeholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void confirm();
            }
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button disabled={!valid || busy} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
