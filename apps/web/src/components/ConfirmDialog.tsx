import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSubmitting } from '@/hooks/useSubmitting';

/**
 * A question before an action that cannot be undone ("Endgültig löschen?"): "Abbrechen" or the action.
 * `onConfirm` runs through `useSubmitting` (a second tap is ignored, errors become toasts); the dialog
 * closes once it succeeded.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  /** The action destroys data: the button is red. */
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
}) {
  const { run, busy } = useSubmitting();
  const confirm = () =>
    void run(async () => {
      await onConfirm();
      onOpenChange(false);
    });
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
