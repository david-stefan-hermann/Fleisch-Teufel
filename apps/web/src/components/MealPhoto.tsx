import { useLiveQuery } from 'dexie-react-hooks';
import { ImageOff, Utensils } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useDb } from '@/app/session';
import { loadPhoto } from '@/db/photos';
import { cn } from '@/lib/utils';

/** Downloads currently running (or failed this session) – one attempt per photo and app start. */
const requested = new Set<string>();

/** The photo blob from the device, fetched once from the server when another device took it. */
export function usePhotoBlob(id: string | null): Blob | null | undefined {
  const db = useDb();
  const local = useLiveQuery(async () => (id ? ((await db.photos.get(id))?.blob ?? null) : null), [db, id]);
  useEffect(() => {
    if (!id || local !== null || requested.has(id)) return;
    requested.add(id);
    void loadPhoto(db, id, (p, init) => fetch(p, { credentials: 'same-origin', ...init })).then(
      (blob) => blob && requested.delete(id),
      () => {},
    );
  }, [db, id, local]);
  return local;
}

/** Object URL for a blob, revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return url;
}

/** Meal photo with a neutral placeholder while loading or when there is none. */
export function MealPhoto({
  photoId,
  blob,
  alt,
  className,
  placeholder = true,
}: {
  photoId?: string | null;
  /** A local blob (e.g. the photo being analysed) instead of a stored photo. */
  blob?: Blob | null;
  alt: string;
  className?: string;
  placeholder?: boolean;
}) {
  const stored = usePhotoBlob(blob ? null : (photoId ?? null));
  const url = useObjectUrl(blob ?? stored);
  if (url) return <img src={url} alt={alt} className={cn('object-cover', className)} draggable={false} />;
  if (!placeholder) return null;
  return (
    <div
      role="img"
      aria-label={photoId ? `${alt} (wird geladen)` : alt}
      className={cn('grid place-items-center bg-muted text-muted-foreground', className)}
    >
      {photoId && stored === null ? (
        <ImageOff className="size-5" aria-hidden />
      ) : (
        <Utensils className="size-5" aria-hidden />
      )}
    </div>
  );
}
