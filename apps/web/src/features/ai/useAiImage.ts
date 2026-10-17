import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '@/app/session';
import type { AiQueueItem } from '@/db/dexie';
import { loadQueuePhotos, type QueuePhoto } from './queue';

/**
 * Photos of a queue item in order (`loadQueuePhotos`): re-read only when its photo rows change, not on
 * every status change of the item. `undefined` while loading.
 */
export function useAiImages(item: AiQueueItem): QueuePhoto[] | undefined {
  const db = useDb();
  const legacy = item.image;
  const localId = item.localId;
  return useLiveQuery(() => loadQueuePhotos(db, { localId, image: legacy }), [db, localId, legacy]);
}
