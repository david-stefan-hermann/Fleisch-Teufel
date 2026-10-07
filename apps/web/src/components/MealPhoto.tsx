import { useLiveQuery } from 'dexie-react-hooks';
import { ImageOff, Utensils } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDb } from '@/app/session';
import type { UserDb } from '@/db/dexie';
import { loadPhoto, photoBlob } from '@/db/photos';
import { cn } from '@/lib/utils';

/** A failed download (offline, server error, not uploaded yet) is retried after this long. */
export const PHOTO_RETRY_MS = 30_000;

/**
 * Start time of the last download attempt per photo id, shared by all components showing the same
 * photo: one request at a time, a failed one is retried after `PHOTO_RETRY_MS` or when the device
 * comes back online. A successful download removes the entry (the photo is then on the device).
 */
const lastAttempt = new Map<string, number>();

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;
const sameOriginFetch: Fetch = (path, init) => fetch(path, { credentials: 'same-origin', ...init });

/** The photo blob from the device, downloaded from the server when another device took it. */
export function usePhotoBlob(id: string | null): Blob | null | undefined {
  return usePhotoBlobFrom(useDb(), id, sameOriginFetch);
}

/** `usePhotoBlob` with an explicit database and fetch (tests). */
export function usePhotoBlobFrom(db: UserDb, id: string | null, fetchFn: Fetch): Blob | null | undefined {
  const local = useLiveQuery(async () => {
    const p = id ? await db.photos.get(id) : undefined;
    return p ? photoBlob(p) : null;
  }, [db, id]);
  // Bumped to re-run the download effect (retry timer, `online` event).
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!id || local !== null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const retryIn = (ms: number) => {
      timer = setTimeout(() => alive && setAttempt((n) => n + 1), Math.max(0, ms));
    };
    const due = (lastAttempt.get(id) ?? -Infinity) + PHOTO_RETRY_MS - Date.now();
    if (due > 0) {
      // Another component (or the previous run of this effect) tried recently.
      retryIn(due);
    } else {
      lastAttempt.set(id, Date.now());
      void loadPhoto(db, id, fetchFn).then(
        (blob) => {
          if (blob) lastAttempt.delete(id);
          else if (alive) retryIn(PHOTO_RETRY_MS);
        },
        () => alive && retryIn(PHOTO_RETRY_MS),
      );
    }
    const onOnline = () => {
      lastAttempt.delete(id);
      setAttempt((n) => n + 1);
    };
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
    };
  }, [db, id, local, fetchFn, attempt]);
  return local;
}

/**
 * Object URL for a blob, revoked when the blob changes or the component unmounts. The URL is
 * created in an effect, so StrictMode's mount/unmount/mount cycle cannot leave a revoked URL behind.
 *
 * Blobs read from IndexedDB are new objects on every live query run (e.g. each status change of an
 * AI analysis). With a `key` that identifies the content (photo id, queue id), a blob with the same
 * key, size and type counts as unchanged, so the image is neither re-created nor re-decoded.
 */
export function useObjectUrl(blob: Blob | null | undefined, key?: string): string | null {
  const next = blob ?? null;
  const [held, setHeld] = useState<{ blob: Blob | null; key: string | undefined }>({ blob: next, key });
  const unchanged =
    next === held.blob ||
    (next !== null &&
      held.blob !== null &&
      key !== undefined &&
      key === held.key &&
      next.size === held.blob.size &&
      next.type === held.blob.type);
  if (!unchanged) setHeld({ blob: next, key });
  const current = unchanged ? held.blob : next;

  const [url, setUrl] = useState<{ blob: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!current) return;
    const created = URL.createObjectURL(current);
    // Syncing an external resource (the object URL) into state is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl({ blob: current, url: created });
    return () => URL.revokeObjectURL(created);
  }, [current]);
  return current && url?.blob === current ? url.url : null;
}

/** Decode attempts of one photo before the "not readable" placeholder shows (first try + retry). */
export const PHOTO_DECODE_ATTEMPTS = 2;

/**
 * Meal photo with a neutral placeholder while loading or when there is none.
 *
 * Safety net for unreadable blobs (WebKit: a Blob read from IndexedDB before its record was
 * rewritten): when the image fails to decode, the held blob is dropped (the `useObjectUrl` key
 * changes), so the latest blob from the database gets a new object URL; after
 * `PHOTO_DECODE_ATTEMPTS` failures the "not readable" placeholder is shown.
 */
export function MealPhoto({
  photoId,
  blob,
  blobKey,
  alt,
  className,
  placeholder = true,
}: {
  photoId?: string | null;
  /** A local blob (e.g. the photo being analysed) instead of a stored photo. */
  blob?: Blob | null;
  /** Stable identity of `blob` across re-reads from IndexedDB (see `useObjectUrl`). */
  blobKey?: string;
  alt: string;
  className?: string;
  placeholder?: boolean;
}) {
  const stored = usePhotoBlob(blob ? null : (photoId ?? null));
  const key = blob ? blobKey : (photoId ?? undefined);
  // Failed decodes per key; another photo starts at zero again.
  const [failed, setFailed] = useState<{ key: string | undefined; n: number }>({ key, n: 0 });
  const failures = failed.key === key ? failed.n : 0;
  const broken = failures >= PHOTO_DECODE_ATTEMPTS;
  const source = broken ? null : (blob ?? stored ?? null);
  // A retry needs a new Blob object even when the database had nothing newer: `slice()` is a cheap
  // view on the same data, so the object URL (and the decode) is created again.
  const attempt = useMemo(
    () => (source && failures > 0 ? source.slice(0, source.size, source.type) : source),
    [source, failures],
  );
  const url = useObjectUrl(attempt, key === undefined ? undefined : `${key}#${failures}`);
  if (url)
    return (
      <img
        src={url}
        alt={alt}
        className={cn('object-cover', className)}
        draggable={false}
        onError={() => setFailed({ key, n: failures + 1 })}
      />
    );
  if (!placeholder) return null;
  return (
    <div
      role="img"
      aria-label={broken ? `${alt} (nicht lesbar)` : photoId ? `${alt} (wird geladen)` : alt}
      className={cn('grid place-items-center bg-muted text-muted-foreground', className)}
    >
      {broken || (photoId && stored === null) ? (
        <ImageOff className="size-5" aria-hidden />
      ) : (
        <Utensils className="size-5" aria-hidden />
      )}
    </div>
  );
}
