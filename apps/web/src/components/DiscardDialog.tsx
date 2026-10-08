import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * "Änderungen verwerfen?" when leaving an editor with unsaved changes (meal editor, training editor),
 * driven by a router blocker: keep editing, discard, or save and leave.
 */
export function DiscardDialog({
  open,
  name,
  onKeepEditing,
  onDiscard,
  onSave,
}: {
  open: boolean;
  /** What was changed, e.g. the meal name. */
  name: string;
  onKeepEditing: () => void;
  onDiscard: () => Promise<void> | void;
  /** Saves; the dialog leaves the page afterwards (via the blocker). */
  onSave: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onKeepEditing()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Änderungen verwerfen?</DialogTitle>
          <DialogDescription>
            Du hast {name} geändert. Ohne Speichern gehen die Änderungen verloren.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onKeepEditing}>
            Weiter bearbeiten
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => void run(onDiscard)}
          >
            Verwerfen
          </Button>
          <Button disabled={busy} onClick={() => void run(onSave)}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
