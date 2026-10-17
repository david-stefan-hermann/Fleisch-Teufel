import { Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { MealPhoto } from '@/components/MealPhoto';
import { cn } from '@/lib/utils';

/** One photo of the strip: a local blob (with a stable `key`) or a stored photo (`photoId`). */
export interface StripPhoto {
  /** Stable identity; also the object URL key of `blob`. */
  key: string;
  blob?: Blob | null;
  photoId?: string;
  /** Short chip on the thumbnail, e.g. "Neu" for a photo not analysed yet. */
  badge?: string;
  removable?: boolean;
}

/**
 * The photos of a meal analysis: the chosen one large, below them the thumbnails (tap shows one
 * large, X removes it) and a "+" tile while there is room. One photo without "+" looks like a single
 * photo. `children` lie over the large photo (the analysis overlay).
 */
export function PhotoStrip({
  photos,
  alt,
  max,
  busy = false,
  addLabel,
  onAdd,
  onRemove,
  children,
}: {
  photos: StripPhoto[];
  /** Alt text of the large photo; thumbnails say "Foto N". */
  alt: string;
  max: number;
  /** Locks adding and removing (analysis running). */
  busy?: boolean;
  /** Accessible name of the "+" tile. */
  addLabel?: string;
  onAdd?: () => void;
  onRemove?: (key: string) => void;
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  // Derived: falls back to the first photo when the selected one is gone.
  const shown = photos.find((p) => p.key === selected) ?? photos[0];
  const canAdd = Boolean(onAdd) && photos.length < max;
  return (
    <div className="grid gap-2">
      {shown && (
        <div className="relative overflow-hidden rounded-2xl border border-border/70">
          <MealPhoto
            {...(shown.blob !== undefined
              ? { blob: shown.blob, blobKey: shown.key }
              : { photoId: shown.photoId })}
            alt={alt}
            className="aspect-[4/3] w-full"
          />
          {children}
        </div>
      )}
      {(photos.length > 1 || canAdd) && (
        <ul className="flex gap-3 overflow-x-auto px-0.5 pt-2.5 pr-2.5 pb-1" aria-label="Fotos">
          {photos.map((p, i) => {
            const active = p.key === shown?.key;
            return (
              <li key={p.key} className="relative size-14 shrink-0">
                <button
                  type="button"
                  aria-label={`Foto ${i + 1} anzeigen`}
                  aria-pressed={active}
                  onClick={() => setSelected(p.key)}
                  className={cn(
                    'block size-14 overflow-hidden rounded-xl border border-border/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                    active && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                  )}
                >
                  <MealPhoto
                    {...(p.blob !== undefined ? { blob: p.blob, blobKey: p.key } : { photoId: p.photoId })}
                    alt=""
                    className="size-14"
                  />
                </button>
                {p.badge && (
                  <span className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-primary px-1 text-[0.6875rem] leading-4 font-semibold text-primary-foreground">
                    {p.badge}
                  </span>
                )}
                {p.removable && onRemove && !busy && (
                  <button
                    type="button"
                    aria-label={`Foto ${i + 1} entfernen`}
                    onClick={() => onRemove(p.key)}
                    // Small on purpose (it sits on the photo); the invisible ring makes the touch target 44 px.
                    className="absolute -top-2.5 -right-2.5 grid size-7 place-items-center rounded-full border-2 border-background bg-neutral-800 text-white after:absolute after:-inset-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <X className="size-3.5" strokeWidth={3} aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
          {canAdd && (
            <li className="shrink-0">
              <button
                type="button"
                aria-label={addLabel}
                disabled={busy}
                onClick={onAdd}
                className="grid size-14 place-items-center rounded-xl border-2 border-dashed border-border text-muted-foreground hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-40"
              >
                <Plus className="size-6" aria-hidden />
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
