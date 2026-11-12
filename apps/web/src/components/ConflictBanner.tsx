import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Shown in an editor whose record changed on another device while this device holds unsaved
 * changes: the person decides whether to start from the new state or keep what they typed.
 */
export function ConflictBanner({
  onReload,
  onKeep,
  children,
}: {
  onReload: () => void;
  onKeep: () => void;
  /** The text; default: the editor's (unsaved changes would overwrite the new state). */
  children?: ReactNode;
}) {
  return (
    <div role="status" className="mb-4 grid gap-2 rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn-text" aria-hidden />
        <p>
          {children ??
            'Auf einem anderen Gerät geändert. Deine Änderungen hier sind noch nicht übernommen und würden den neuen Stand überschreiben.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onReload}>
          Neu laden
        </Button>
        <Button variant="ghost" size="sm" onClick={onKeep}>
          Meine Änderungen behalten
        </Button>
      </div>
    </div>
  );
}
