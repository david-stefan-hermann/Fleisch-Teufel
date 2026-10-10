import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';
import type { AiQueueItem } from '@/db/dexie';
import { imageBlob } from './queue';

/**
 * Photo of a queue item: the `aiImages` row (re-read only when that row changes, not on every
 * status change of the item), or the inline Blob of an item from an older app version.
 * `undefined` while loading, `null` when there is none.
 */
export function useAiImage(item: AiQueueItem): Blob | null | undefined {
  const db = useDb();
  const legacy = item.image ?? null;
  return useLiveQuery(async () => {
    const row = item.localId !== undefined ? await db.aiImages.get(item.localId) : undefined;
    return row ? imageBlob(row) : legacy;
  }, [db, item.localId, legacy]);
}
