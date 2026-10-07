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
  blob: Blob;
  /** 0 = waiting for upload, 1 = on the server (IndexedDB cannot index booleans). */
  uploaded: 0 | 1;
  createdAt: number;
}

type Fetch = (path: string, init?: RequestInit) => Promise<Response>;

export class PhotoHttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** Saves an (already compressed) image locally and queues it for upload; returns its id. */
export async function storePhoto(db: UserDb, blob: Blob): Promise<string> {
  const id = uuidv7();
  await db.photos.put({ id, blob, uploaded: 0, createdAt: Date.now() });
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
    const res = await fetchFn(`/api/photos/${encodeURIComponent(p.id)}`, {
      method: 'PUT',
      headers: { 'content-type': p.blob.type || 'image/jpeg' },
      body: p.blob,
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
  if (local) return local.blob;
  const res = await fetchFn(`/api/photos/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new PhotoHttpError(res.status);
  const blob = await res.blob();
  await db.photos.put({ id, blob, uploaded: 1, createdAt: Date.now() });
  return blob;
}
