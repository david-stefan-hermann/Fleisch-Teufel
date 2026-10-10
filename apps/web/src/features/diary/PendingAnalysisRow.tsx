import { Link } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import type { AiQueueItem } from '@/db/dexie';
import { restoreQueueItem, retryQueueItem, takeQueueItem } from '@/features/ai/queue';
import { useAiImage } from '@/features/ai/useAiImage';
import { NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useDiaryDrag } from './DiaryDnd';

/**
 * A photo that is not analysed yet, shown in its diary meal so it is visibly safe while offline:
 * the photo, the hint as title, the state, and no kcal (it counts in no sum). Once analysed the
 * queue logs it as a normal group (`logDeferred`) and this row goes away.
 *
 * Swipe left discards the photo (with undo), a failed analysis has "Wiederholen". The row itself is
 * a stretched link to the food page (like the group rows: a button cannot sit inside a link).
 */
export function PendingAnalysisRow({ item }: { item: AiQueueItem }) {
  const db = useDb();
  const image = useAiImage(item);
  const { dragging } = useDiaryDrag();
  const failed = item.status === 'failed';
  const name = item.text.trim() || 'Foto-Analyse';
  const state =
    item.status === 'analyzing'
      ? 'Wird analysiert…'
      : failed
        ? (item.error ?? 'Analyse fehlgeschlagen')
        : 'Gespeichert, wird analysiert sobald du online bist';

  async function discard() {
    const taken = await takeQueueItem(db, item.localId!);
    if (!taken) return;
    toast(`${name} gelöscht`, {
      action: { label: 'Rückgängig', onClick: () => void restoreQueueItem(db, taken) },
    });
  }

  return (
    <SwipeToDelete label={`${name} löschen`} onDelete={() => void discard()} disabled={dragging}>
      <div className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2 transition-colors select-none hover:bg-accent/60 has-[a:focus-visible]:bg-accent">
        <div className="relative size-12 shrink-0">
          <MealPhoto
            blob={image}
            blobKey={`ai:${item.localId}`}
            alt=""
            className={cn('size-12 rounded-lg', item.status !== 'analyzing' && 'saturate-50')}
          />
          {item.status === 'analyzing' && (
            <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 text-white">
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            to="/photo"
            search={{ date: item.date, meal: item.meal }}
            draggable={false}
            className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none"
          >
            {name}
          </Link>
          <div className={cn('text-xs text-muted-foreground', failed && 'text-over')}>{state}</div>
          {failed && (
            <button
              type="button"
              draggable={false}
              onClick={() => void retryQueueItem(db, item.localId!)}
              className="relative z-10 -my-1 rounded-md py-2 pr-3 text-sm font-medium text-primary underline underline-offset-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              Wiederholen
            </button>
          )}
        </div>
        <div
          className="tabular text-right font-semibold text-muted-foreground"
          aria-label="noch keine Kalorien"
        >
          {NO_VALUE}
        </div>
      </div>
    </SwipeToDelete>
  );
}
