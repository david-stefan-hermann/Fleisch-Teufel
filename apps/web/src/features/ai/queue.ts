/**
 * AI photo queue: photos taken offline are stored in IndexedDB and analyzed as soon as the
 * server is reachable (app start, coming online, opening the photo screen). Until then they show
 * as placeholder rows in the diary (`PendingAnalysisRow`), afterwards they are logged by themselves.
 *
 * The photo of an item lives in `aiImages` (bytes, same `localId`), not on the queue item itself:
 * the item is rewritten on every status change and review edit, which on WebKit made an inline
 * Blob read earlier unreadable (see `AiImage` in `db/dexie.ts`).
 */
import type { AiAnalysisResult } from '@ft/shared';
import { toast } from 'sonner';
import { draftFromResult, type AiItem } from '@/db/aiDraft';
import type { AiImage, AiQueueItem, UserDb } from '@/db/dexie';
import { logAiItems } from '@/db/entries';
import { rememberFood } from '@/foods/foodService';
import { api, ApiError, OfflineError, errorMessage } from '@/lib/api';

export async function analyzePhoto(image: Blob, text: string): Promise<AiAnalysisResult> {
  const form = new FormData();
  form.set('image', new File([image], 'meal.jpg', { type: image.type || 'image/jpeg' }));
  if (text.trim()) form.set('text', text.trim());
  return api<AiAnalysisResult>('/api/ai/analyze', { method: 'POST', body: form, timeoutMs: 120_000 });
}

/** The stored photo as an in-memory Blob (a fresh object, always readable). */
export function imageBlob(row: AiImage): Blob {
  return new Blob([row.bytes], { type: row.type || 'image/jpeg' });
}

/** Photo of a queue item: the `aiImages` row, or the inline Blob of a not yet migrated item. */
export async function loadQueueImage(db: UserDb, item: AiQueueItem): Promise<Blob | null> {
  const row = item.localId !== undefined ? await db.aiImages.get(item.localId) : undefined;
  return row ? imageBlob(row) : (item.image ?? null);
}

/**
 * Moves inline photos of items from older app versions into `aiImages` (once per item) and removes
 * photos whose queue item is gone. Blobs are read before the write transaction: an IndexedDB
 * transaction closes while it waits for a non-IndexedDB promise such as `arrayBuffer()`.
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
    await db.transaction('rw', [db.aiQueue, db.aiImages], async () => {
      if (bytes && !(await db.aiImages.get(item.localId!)))
        await db.aiImages.put({ localId: item.localId!, bytes, type: item.image!.type || 'image/jpeg' });
      // Dexie removes a property that is updated to undefined.
      await db.aiQueue.update(
        item.localId!,
        bytes || item.status === 'done' || item.status === 'failed'
          ? { image: undefined }
          : { image: undefined, status: 'failed', error: 'Foto nicht mehr lesbar' },
      );
    });
  }
  await db.transaction('rw', [db.aiQueue, db.aiImages], async () => {
    const ids = new Set((await db.aiQueue.toCollection().primaryKeys()) as number[]);
    const orphans = ((await db.aiImages.toCollection().primaryKeys()) as number[]).filter((k) => !ids.has(k));
    if (orphans.length) await db.aiImages.bulkDelete(orphans);
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
 * Logs the analysed photos that had to wait for a connection (`deferred`) into the diary, as a
 * named group with the photo, exactly like "Meal eintragen" of an unchanged review: first
 * candidate of every item, the model's grams. The diary row leads to the group editor for changes.
 * An analysis without any usable item stays in the queue as a normal review.
 */
export async function logDeferred(db: UserDb): Promise<void> {
  const ready = (await db.aiQueue.toArray()).filter((i) => i.status === 'done' && i.deferred && i.result);
  for (const item of ready) {
    const draft = item.draft ?? draftFromResult(item);
    const items: AiItem[] = draft.rows.flatMap((r) => {
      const food = r.candidates.find((c) => c.id === r.foodId);
      return food && r.grams && r.grams > 0 ? [{ food, grams: r.grams, portion: r.portion }] : [];
    });
    if (items.length === 0) {
      await db.aiQueue.update(item.localId!, { deferred: false });
      continue;
    }
    const image = await loadQueueImage(db, item);
    await logAiItems(db, draft.mealName, items, { date: item.date, meal: draft.meal }, item.result!, image);
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
    const image = await loadQueueImage(db, item);
    if (!image) {
      await db.aiQueue.update(item.localId!, { status: 'failed', error: 'Foto nicht mehr vorhanden' });
      continue;
    }
    await db.aiQueue.update(item.localId!, { status: 'analyzing' });
    try {
      const result = await analyzePhoto(image, item.text);
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
        await db.aiQueue.update(item.localId!, { status: 'done', result, error: undefined, draft });
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
 * "Neu analysieren" from the review: the same photo with the (edited) hint, as one more Claude call.
 * Nothing happens while the item is still waiting or being analyzed. Resolves with the item's
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

/** Queues a photo for analysis; returns the new item's `localId`. */
export async function enqueuePhoto(
  db: UserDb,
  item: Omit<AiQueueItem, 'localId' | 'status' | 'createdAt' | 'image'>,
  image: Blob,
): Promise<number> {
  // Read before the transaction (see `migrateLegacyImages`).
  const bytes = await image.arrayBuffer();
  return db.transaction('rw', [db.aiQueue, db.aiImages], async () => {
    const localId = (await db.aiQueue.add({ ...item, status: 'pending', createdAt: Date.now() })) as number;
    await db.aiImages.put({ localId, bytes, type: image.type || 'image/jpeg' });
    return localId;
  });
}

/** Removes a queue item and its photo (discarded, or saved to the diary). */
export async function discardQueueItem(db: UserDb, localId: number): Promise<void> {
  await db.transaction('rw', [db.aiQueue, db.aiImages], async () => {
    await db.aiQueue.delete(localId);
    await db.aiImages.delete(localId);
  });
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
