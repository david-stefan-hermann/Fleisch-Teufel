import { Link } from '@tanstack/react-router';
import { LoaderCircle } from 'lucide-react';
import { MealPhoto } from '@/components/MealPhoto';
import type { AiQueueItem } from '@/db/dexie';
import { useAiImage } from '@/features/ai/useAiImage';
import { NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A photo that is not analysed yet, shown in its diary meal so it is visibly safe while offline:
 * the photo, the hint as title, the state, and no kcal (it counts in no sum). Once analysed the
 * queue logs it as a normal group (`logDeferred`) and this row goes away. The row leads to the
 * food page, whose queue can retry or discard the photo.
 */
export function PendingAnalysisRow({ item }: { item: AiQueueItem }) {
  const image = useAiImage(item);
  const failed = item.status === 'failed';
  const state =
    item.status === 'analyzing'
      ? 'Wird analysiert…'
      : failed
        ? (item.error ?? 'Analyse fehlgeschlagen')
        : 'Gespeichert, wird analysiert sobald du online bist';
  return (
    <Link
      to="/photo"
      search={{ date: item.date, meal: item.meal }}
      className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
    >
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
        <div className="truncate font-medium">{item.text.trim() || 'Foto-Analyse'}</div>
        <div className={cn('text-xs text-muted-foreground', failed && 'text-over')}>{state}</div>
      </div>
      <div
        className="tabular text-right font-semibold text-muted-foreground"
        aria-label="noch keine Kalorien"
      >
        {NO_VALUE}
      </div>
    </Link>
  );
}
