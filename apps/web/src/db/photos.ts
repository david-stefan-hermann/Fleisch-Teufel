/**
 * Meal photos on the device. A new photo is stored locally right away (works offline) and uploaded
 * by the sync engine before the records that reference it; other devices download a photo the first
 * time they show it and keep it in IndexedDB. Photos are immutable, a changed photo gets a new id.
 *
 * Free of `@/` aliases on purpose: the API test suite runs this against the real server.
 */
import { uuidv7 } from '@ft/shared';
import type { UserDb } from './dexie';

export interface LocalPhoto {
  id: string;
  /**
   * The image as bytes. Stored as ArrayBuffer rather than Blob: WebKit keeps IndexedDB Blobs as
   * files, and a Blob read before its record is written again (`uploaded` after the upload) can
   * no longer be read. Bytes are copied on every read.
   */
  bytes?: ArrayBuffer;
  /** MIME type of `bytes`. */
  type?: string;
  /** Legacy (before Dexie v4): the image as Blob. Still read, never written. */
  blob?: Blob;
  /** 0 = waiting for upload, 1 = on the server (IndexedDB cannot index booleans). */
  /** 0 waiting, 1 on the server, 2 refused for good (`PHOTO_REJECTED`). */
  uploaded: 0 | 1 | 2;
  createdAt: number;
}

/** The photo as an in-memory Blob (new or legacy form); null when the record holds no image. */
export function photoBlob(p: LocalPhoto): Blob | null {
  if (p.bytes) return new Blob([p.bytes], { type: p.type || 'image/jpeg' });
  return p.blob ?? null;
}

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

export class PhotoHttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/**
 * Saves an image locally and queues it for upload; returns its id. Callers pass an image already
 * compressed with `compressImage` (`features/ai/image.ts`: a preset and at most 1080p); every
 * caller does: AI meal and AI diary group (the queue photo), meal editor (`MealEditor` pick).
 */
export async function storePhoto(db: UserDb, blob: Blob): Promise<string> {
  return storePhotoBytes(db, await blob.arrayBuffer(), blob.type);
}

/**
 * `storePhoto` for bytes already read: awaits only IndexedDB, so it can run inside a transaction
 * (that includes `photos`), e.g. when a draft with new photos is saved.
 */
export async function storePhotoBytes(db: UserDb, bytes: ArrayBuffer, type: string): Promise<string> {
  const id = uuidv7();
  await db.photos.put({ id, bytes, type: type || 'image/jpeg', uploaded: 0, createdAt: Date.now() });
  return id;
}

/** Upload state of a device photo: 0 waiting, 1 on the server, 2 refused for good (never retried). */
export const PHOTO_REJECTED = 2;

export interface PhotoUploadResult {
  uploaded: number;
  /** First failure of this run (network, 5xx, 429, 401); the remaining photos were still tried. */
  error: Error | null;
}

/**
 * Uploads all photos that are not on the server yet. A failing upload (network, 5xx, 429) does not
 * stop the others and never blocks the record push: the first error is returned for the status.
 * A photo the server refuses for good (too large, not an image) is marked as rejected so it cannot
 * block the queue forever.
 */
export async function uploadPendingPhotos(db: UserDb, fetchFn: Fetch): Promise<PhotoUploadResult> {
  const pending = await db.photos.where('uploaded').equals(0).toArray();
  let uploaded = 0;
  let error: Error | null = null;
  for (const p of pending) {
    const body = p.bytes ?? p.blob;
    if (!body) {
      // Nothing to upload (should not happen); never let it block the queue.
      await db.photos.update(p.id, { uploaded: PHOTO_REJECTED });
      continue;
    }
    try {
      const res = await fetchFn(`/api/photos/${encodeURIComponent(p.id)}`, {
        method: 'PUT',
        headers: { 'content-type': p.type || p.blob?.type || 'image/jpeg' },
        body,
      });
      if (res.ok) {
        await db.photos.update(p.id, { uploaded: 1 });
        uploaded++;
      } else if (res.status === 413 || res.status === 415 || res.status === 400) {
        await db.photos.update(p.id, { uploaded: PHOTO_REJECTED });
      } else {
        throw new PhotoHttpError(res.status);
      }
    } catch (e) {
      error ??= e instanceof Error ? e : new Error(String(e));
      // The session is gone: every further upload would fail the same way.
      if (e instanceof PhotoHttpError && e.status === 401) break;
    }
  }
  return { uploaded, error };
}

/** Number of photos the server refused for good (shown under "Daten & Sync"). */
export function countRejectedPhotos(db: UserDb): Promise<number> {
  return db.photos.where('uploaded').equals(PHOTO_REJECTED).count();
}

/** Returns the photo from the device, downloading it once if another device took it. */
export async function loadPhoto(db: UserDb, id: string, fetchFn: Fetch): Promise<Blob | null> {
  const local = await db.photos.get(id);
  const stored = local && photoBlob(local);
  if (stored) return stored;
  const res = await fetchFn(`/api/photos/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new PhotoHttpError(res.status);
  const type = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
  const bytes = await res.arrayBuffer();
  await db.photos.put({ id, bytes, type, uploaded: 1, createdAt: Date.now() });
  return new Blob([bytes], { type });
}
