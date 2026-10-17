/**
 * AI photo queue: photos taken offline are stored in IndexedDB and analyzed as soon as the
 * server is reachable (app start, coming online, opening the photo screen). Until then they show
 * as placeholder rows in the diary (`PendingAnalysisRow`), afterwards they are logged by themselves.
 * The same happens to an analysis the person left the photo page during (`leaveAnalysis`).
 *
 * An item has one to `MAX_ANALYSIS_PHOTOS` photos in `aiPhotos` (bytes, by `localId`), not on the
 * item itself: the item is rewritten on every status change and review edit, which on WebKit made an
 * inline Blob read earlier unreadable (see `AiImage` in `db/dexie.ts`).
 */
import type { AiAnalysisResult } from '@ft/shared';
import { toast } from 'sonner';
import { draftFromResult, type AiItem } from '@/db/aiDraft';
import type { AiPhoto, AiQueueItem, UserDb } from '@/db/dexie';
import { logAiItems } from '@/db/entries';
import { rememberFood } from '@/foods/foodService';
import { api, ApiError, OfflineError, errorMessage } from '@/lib/api';

/** One meal analysis: all photos in one request (field `image` repeated), with the optional hint. */
export async function analyzePhotos(images: readonly Blob[], text: string): Promise<AiAnalysisResult> {
  const form = new FormData();
  images.forEach((image, i) =>
    form.append('image', new File([image], `meal-${i + 1}.jpg`, { type: image.type || 'image/jpeg' })),
  );
  if (text.trim()) form.set('text', text.trim());
  return api<AiAnalysisResult>('/api/ai/analyze', { method: 'POST', body: form, timeoutMs: 120_000 });
}

/** A stored photo as an in-memory Blob (a fresh object, always readable). */
export function imageBlob(row: { bytes: ArrayBuffer; type: string }): Blob {
  return new Blob([row.bytes], { type: row.type || 'image/jpeg' });
}

/** A photo of a queue item; `id` is its `aiPhotos` id (0 for a not yet migrated one). */
export interface QueuePhoto {
  id: number;
  blob: Blob;
}

/**
 * Photos of a queue item in order: its `aiPhotos` rows, else (not migrated yet) the `aiImages` row
 * or the inline Blob of an item from an older app version.
 */
export async function loadQueuePhotos(
  db: UserDb,
  item: Pick<AiQueueItem, 'localId' | 'image'>,
): Promise<QueuePhoto[]> {
  if (item.localId === undefined) return item.image ? [{ id: 0, blob: item.image }] : [];
  const rows = await db.aiPhotos.where('localId').equals(item.localId).sortBy('id');
  if (rows.length > 0) return rows.map((r) => ({ id: r.id!, blob: imageBlob(r) }));
  const old = await db.aiImages.get(item.localId);
  if (old) return [{ id: 0, blob: imageBlob(old) }];
  return item.image ? [{ id: 0, blob: item.image }] : [];
}

export async function loadQueueImages(
  db: UserDb,
  item: Pick<AiQueueItem, 'localId' | 'image'>,
): Promise<Blob[]> {
  return (await loadQueuePhotos(db, item)).map((p) => p.blob);
}

/**
 * Moves photos of older app versions into `aiPhotos`: inline Blobs (before Dexie v4) and `aiImages`
 * rows (v4). An analysed item records its moved photo as analysed. Photos whose queue item is gone are
 * removed. Blobs are read before the write transaction: an IndexedDB transaction closes while it waits
 * for a non-IndexedDB promise such as `arrayBuffer()`.
 */
export async function migrateLegacyImages(db: UserDb): Promise<void> {
  const legacy = await db.aiQueue.filter((i) => i.image !== undefined).toArray();
  for (const item of legacy) {
    let bytes: ArrayBuffer | null = null;
    try {
      bytes = await item.image!.arrayBuffer();
    } catch {
      // Unreadable (the WebKit bug this table works around). A finished analysis stays reviewable
      // without its photo; one that still needs the photo cannot be analyzed any more.
    }
    await db.transaction('rw', [db.aiQueue, db.aiPhotos], async () => {
      const has = (await db.aiPhotos.where('localId').equals(item.localId!).count()) > 0;
      let id: number | undefined;
      if (bytes && !has)
        id = (await db.aiPhotos.add({
          localId: item.localId!,
          bytes,
          type: item.image!.type || 'image/jpeg',
          createdAt: item.createdAt,
        })) as number;
      // Dexie removes a property that is updated to undefined.
      await db.aiQueue.update(
        item.localId!,
        bytes || item.status === 'done' || item.status === 'failed'
          ? { image: undefined, ...(id && item.result ? { analyzedPhotoIds: [id] } : {}) }
          : { image: undefined, status: 'failed', error: 'Foto nicht mehr lesbar' },
      );
    });
  }
  await db.transaction('rw', [db.aiQueue, db.aiImages, db.aiPhotos], async () => {
    const items = new Map((await db.aiQueue.toArray()).map((i) => [i.localId!, i]));
    // v4 rows: one photo per item, into aiPhotos (unless the item has photos there already).
    for (const row of await db.aiImages.toArray()) {
      const item = items.get(row.localId);
      if (item && (await db.aiPhotos.where('localId').equals(row.localId).count()) === 0) {
        const id = (await db.aiPhotos.add({
          localId: row.localId,
          bytes: row.bytes,
          type: row.type,
          createdAt: item.createdAt,
        })) as number;
        if (item.result && !item.analyzedPhotoIds)
          await db.aiQueue.update(row.localId, { analyzedPhotoIds: [id] });
      }
    }
    await db.aiImages.clear();
    const orphans = (await db.aiPhotos.toArray()).filter((p) => !items.has(p.localId)).map((p) => p.id!);
    if (orphans.length) await db.aiPhotos.bulkDelete(orphans);
  });
}

let current: Promise<void> | null = null;
let again = false;

/**
 * Processes pending items one by one; stops at the first network failure. A call while a run is
 * going on makes that run look for pending items once more and resolves with it, so an item queued
 * meanwhile (e.g. a re-analysis) is never left waiting.
 */
export async function processQueue(db: UserDb): Promise<void> {
  if (current) {
    again = true;
    return current;
  }
  current = (async () => {
    try {
      do {
        again = false;
        await runQueue(db);
      } while (again);
    } finally {
      current = null;
    }
  })();
  return current;
}

/**
 * Logs the analyses that had to wait for a connection or were left on the photo page (`deferred`)
 * into the diary, as a named group with all photos, exactly like "Meal eintragen" of an unchanged
 * review: first candidate of every item, the model's grams. The diary row leads to the group editor
 * for changes. An analysis without any usable item stays in the queue as a normal review.
 *
 * Runs only inside `runQueue` (serialized by `processQueue`), so an item is never logged twice.
 */
async function logDeferred(db: UserDb): Promise<void> {
  const ready = (await db.aiQueue.toArray()).filter((i) => i.status === 'done' && i.deferred && i.result);
  for (const item of ready) {
    const draft = item.draft ?? draftFromResult(item);
    const items: AiItem[] = draft.rows.flatMap((r) => {
      const food = r.candidates.find((c) => c.id === r.foodId);
      return food && r.grams && r.grams > 0 ? [{ food, grams: r.grams, portion: r.portion }] : [];
    });
    if (items.length === 0) {
      await db.aiQueue.update(item.localId!, { deferred: false });
      // Its placeholder row leaves the diary; say where it went.
      toast('Kein Essen erkannt', { description: 'Das Foto liegt unter „Analysen“ auf der Foto-Seite.' });
      continue;
    }
    const images = await loadQueueImages(db, item);
    await logAiItems(db, draft.mealName, items, { date: item.date, meal: draft.meal }, item.result!, images);
    for (const i of items) await rememberFood(db, i.food);
    await discardQueueItem(db, item.localId!);
    toast.success(`„${draft.mealName}“ analysiert und eingetragen`);
  }
}

async function runQueue(db: UserDb): Promise<void> {
  await migrateLegacyImages(db);
  // Analysed but not logged yet (app closed in between).
  await logDeferred(db);
  // Items stuck in "analyzing" (app closed mid-request) are retried.
  await db.aiQueue
    .where('localId')
    .above(0)
    .modify((i) => {
      if (i.status === 'analyzing') i.status = 'pending';
    });
  for (;;) {
    const item = (await db.aiQueue.toArray()).find((i) => i.status === 'pending');
    if (!item) break;
    const photos = await loadQueuePhotos(db, item);
    if (photos.length === 0) {
      await db.aiQueue.update(item.localId!, { status: 'failed', error: 'Foto nicht mehr vorhanden' });
      continue;
    }
    await db.aiQueue.update(item.localId!, { status: 'analyzing' });
    try {
      const result = await analyzePhotos(
        photos.map((p) => p.blob),
        item.text,
      );
      await db.transaction('rw', db.aiQueue, async () => {
        const now = await db.aiQueue.get(item.localId!);
        if (!now) return; // discarded meanwhile
        // A re-analysis replaces the review rows. The meal choice stays, and a review already saved
        // as a meal stays linked to it (with its name); the meal itself changes when it is logged.
        const old = now.draft;
        const draft = old
          ? {
              ...draftFromResult({ meal: old.meal, result }),
              ...(old.savedMealId ? { savedMealId: old.savedMealId, mealName: old.mealName } : {}),
            }
          : undefined;
        await db.aiQueue.update(item.localId!, {
          status: 'done',
          result,
          error: undefined,
          draft,
          analyzedPhotoIds: photos.map((p) => p.id),
        });
      });
      await logDeferred(db);
    } catch (e) {
      if (e instanceof OfflineError) {
        // A first analysis that has to wait is logged by itself later; a re-analysis keeps its review.
        await db.aiQueue.update(item.localId!, {
          status: 'pending',
          ...(item.result ? {} : { deferred: true }),
        });
        break;
      }
      // A failed re-analysis keeps the previous result and review rows.
      await db.aiQueue.update(item.localId!, { status: 'failed', error: errorMessage(e) });
      if (e instanceof ApiError && e.status === 401) break;
    }
  }
}

/**
 * "Neu analysieren" from the review: all current photos with the (edited) hint, as one more Claude
 * call. Nothing happens while the item is still waiting or being analyzed. Resolves with the item's
 * status afterwards ('pending': offline, it runs once connected).
 */
export async function reanalyze(
  db: UserDb,
  localId: number,
  text: string,
): Promise<AiQueueItem['status'] | 'busy' | 'missing'> {
  const started = await db.transaction('rw', db.aiQueue, async () => {
    const item = await db.aiQueue.get(localId);
    if (!item) return 'missing' as const;
    if (item.status === 'pending' || item.status === 'analyzing') return 'busy' as const;
    await db.aiQueue.update(localId, { text: text.trim(), status: 'pending', error: undefined });
    return 'started' as const;
  });
  if (started !== 'started') return started;
  await processQueue(db);
  return (await db.aiQueue.get(localId))?.status ?? 'missing';
}

/** Reads the bytes of `images` (before any transaction, see `migrateLegacyImages`). */
async function photoRows(localId: number, images: readonly Blob[]): Promise<AiPhoto[]> {
  const now = Date.now();
  return Promise.all(
    images.map(async (image) => ({
      localId,
      bytes: await image.arrayBuffer(),
      type: image.type || 'image/jpeg',
      createdAt: now,
    })),
  );
}

/** Queues the photos of one meal for analysis; returns the new item's `localId`. */
export async function enqueuePhotos(
  db: UserDb,
  item: Omit<AiQueueItem, 'localId' | 'status' | 'createdAt' | 'image'>,
  images: readonly Blob[],
): Promise<number> {
  const rows = await photoRows(0, images);
  return db.transaction('rw', [db.aiQueue, db.aiPhotos], async () => {
    const localId = (await db.aiQueue.add({ ...item, status: 'pending', createdAt: Date.now() })) as number;
    await db.aiPhotos.bulkAdd(rows.map((r) => ({ ...r, localId })));
    return localId;
  });
}

/** Adds photos to a queue item (review "Fotos hinzufügen"); they are analysed with the next ↻. */
export async function addQueuePhotos(db: UserDb, localId: number, images: readonly Blob[]): Promise<void> {
  const rows = await photoRows(localId, images);
  await db.aiPhotos.bulkAdd(rows);
}

/** Removes one photo of a queue item (review). */
export async function removeQueuePhoto(db: UserDb, id: number): Promise<void> {
  await db.aiPhotos.delete(id);
}

/**
 * The person left the photo page while the first analysis of this item ran: it is logged by itself
 * once done (like an offline photo) and its review never opens. The queue run does the logging, so
 * a result arriving at the same moment is not logged twice.
 */
export async function leaveAnalysis(db: UserDb, localId: number): Promise<void> {
  await db.aiQueue.update(localId, { deferred: true });
  void processQueue(db);
}

/** Removes a queue item and its photos (discarded, or saved to the diary). */
export async function discardQueueItem(db: UserDb, localId: number): Promise<void> {
  await db.transaction('rw', [db.aiQueue, db.aiPhotos, db.aiImages], async () => {
    await db.aiQueue.delete(localId);
    await db.aiPhotos.where('localId').equals(localId).delete();
    await db.aiImages.delete(localId);
  });
}

/** "Wiederholen" of a failed analysis: back into the line, analysed right away when connected. */
export async function retryQueueItem(db: UserDb, localId: number): Promise<void> {
  await db.aiQueue.update(localId, { status: 'pending', error: undefined });
  void processQueue(db);
}

/** A discarded queue item with its photos, for the undo of the diary's swipe delete. */
export interface DiscardedQueueItem {
  item: AiQueueItem;
  photos: AiPhoto[];
}

/** Discards a queue item and returns what `restoreQueueItem` needs to bring it back. */
export async function takeQueueItem(db: UserDb, localId: number): Promise<DiscardedQueueItem | null> {
  return db.transaction('rw', [db.aiQueue, db.aiPhotos, db.aiImages], async () => {
    const item = await db.aiQueue.get(localId);
    if (!item) return null;
    let photos = await db.aiPhotos.where('localId').equals(localId).sortBy('id');
    const old = await db.aiImages.get(localId);
    // Not migrated yet: the v4 photo comes back as an aiPhotos row.
    if (photos.length === 0 && old)
      photos = [{ localId, bytes: old.bytes, type: old.type, createdAt: item.createdAt }];
    await db.aiQueue.delete(localId);
    await db.aiPhotos.where('localId').equals(localId).delete();
    await db.aiImages.delete(localId);
    return { item, photos };
  });
}

/** Undo of `takeQueueItem`: the item waits again (a run it was in is gone) and is analysed when connected. */
export async function restoreQueueItem(db: UserDb, taken: DiscardedQueueItem): Promise<void> {
  const { item, photos } = taken;
  await db.transaction('rw', [db.aiQueue, db.aiPhotos], async () => {
    await db.aiQueue.put({ ...item, status: item.status === 'analyzing' ? 'pending' : item.status });
    if (photos.length) await db.aiPhotos.bulkPut(photos);
  });
  void processQueue(db);
}

export function startQueueProcessing(db: UserDb): () => void {
  const run = () => void processQueue(db);
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', run);
  run();
  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', run);
  };
}
