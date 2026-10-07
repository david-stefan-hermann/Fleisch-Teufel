/**
 * AI photo queue: photos taken offline are stored in IndexedDB and analyzed as soon as the
 * server is reachable (app start, coming online, opening the photo screen).
 */
import type { AiAnalysisResult } from '@ft/shared';
import type { AiQueueItem, UserDb } from '@/db/dexie';
import { api, ApiError, OfflineError, errorMessage } from '@/lib/api';

export async function analyzePhoto(image: Blob, text: string): Promise<AiAnalysisResult> {
  const form = new FormData();
  form.set('image', new File([image], 'meal.jpg', { type: image.type || 'image/jpeg' }));
  if (text.trim()) form.set('text', text.trim());
  return api<AiAnalysisResult>('/api/ai/analyze', { method: 'POST', body: form, timeoutMs: 120_000 });
}

let running = false;

/** Processes pending items one by one; stops at the first network failure. */
export async function processQueue(db: UserDb): Promise<void> {
  if (running) return;
  running = true;
  try {
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
      await db.aiQueue.update(item.localId!, { status: 'analyzing' });
      try {
        const result = await analyzePhoto(item.image, item.text);
        await db.aiQueue.update(item.localId!, { status: 'done', result, error: undefined });
      } catch (e) {
        if (e instanceof OfflineError) {
          await db.aiQueue.update(item.localId!, { status: 'pending' });
          break;
        }
        await db.aiQueue.update(item.localId!, { status: 'failed', error: errorMessage(e) });
        if (e instanceof ApiError && e.status === 401) break;
      }
    }
  } finally {
    running = false;
  }
}

export async function enqueuePhoto(
  db: UserDb,
  item: Omit<AiQueueItem, 'localId' | 'status' | 'createdAt'>,
): Promise<number> {
  return (await db.aiQueue.add({ ...item, status: 'pending', createdAt: Date.now() })) as number;
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
