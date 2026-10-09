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
  uploaded: 0 | 1;
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
  const id = uuidv7();
  const bytes = await blob.arrayBuffer();
  await db.photos.put({ id, bytes, type: blob.type || 'image/jpeg', uploaded: 0, createdAt: Date.now() });
  return id;
}

/**
 * Uploads all photos that are not on the server yet. Network errors and 401 propagate (the sync
 * run reports offline/unauthorized); a photo the server refuses for good (too large, not an image)
 * is marked as done so it cannot block the queue forever.
 */
export async function uploadPendingPhotos(db: UserDb, fetchFn: Fetch): Promise<number> {
  const pending = await db.photos.where('uploaded').equals(0).toArray();
  let uploaded = 0;
  for (const p of pending) {
    const body = p.bytes ?? p.blob;
    if (!body) {
      // Nothing to upload (should not happen); never let it block the queue.
      await db.photos.update(p.id, { uploaded: 1 });
      continue;
    }
    const res = await fetchFn(`/api/photos/${encodeURIComponent(p.id)}`, {
      method: 'PUT',
      headers: { 'content-type': p.type || p.blob?.type || 'image/jpeg' },
      body,
    });
    if (res.ok || res.status === 413 || res.status === 415 || res.status === 400) {
      await db.photos.update(p.id, { uploaded: 1 });
      if (res.ok) uploaded++;
      continue;
    }
    throw new PhotoHttpError(res.status);
  }
  return uploaded;
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
