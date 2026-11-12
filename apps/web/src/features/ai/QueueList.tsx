import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto, PhotoCount } from '@/components/MealPhoto';
import { Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { AiQueueItem } from '@/db/dexie';
import { fmtTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { restoreQueueItem, retryQueueItem, takeQueueItem } from './queue';
import { useAiImages } from './useAiImage';

/** Remembers whether "Offene Analysen" on the food page is open (per device, default closed). */
const QUEUE_OPEN_KEY = 'ft:photo:queueOpen';
function readQueueOpen(): boolean {
  try {
    return localStorage.getItem(QUEUE_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}
function writeQueueOpen(open: boolean) {
  try {
    localStorage.setItem(QUEUE_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* private mode: just not remembered */
  }
}

/** "Offene Analysen (N)" on the food page: collapsible, closed by default, remembered per device. */
export function QueueList({ queue, onOpen }: { queue: AiQueueItem[]; onOpen: (localId: number) => void }) {
  const [open, setOpen] = useState(readQueueOpen);
  return (
    <Section className="mt-4">
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          writeQueueOpen(next);
        }}
      >
        <CollapsibleTrigger className="group flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none">
          <h2 className="text-base font-semibold">Offene Analysen ({queue.length})</h2>
          <ChevronDown
            className="size-5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="divide-y divide-border/70 border-t border-border/70">
            {queue.map((q) => (
              <QueueRow key={q.localId} item={q} onOpen={() => onOpen(q.localId!)} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

/**
 * One open analysis on the food page: waiting, running, failed, or finished and waiting for its
 * review (a tap opens it). Swipe left discards it with undo, like the rows of the diary; a failed
 * one has "Wiederholen".
 */
function QueueRow({ item, onOpen }: { item: AiQueueItem; onOpen: () => void }) {
  const db = useDb();
  const photos = useAiImages(item);
  const first = photos?.[0];
  const failed = item.status === 'failed' && !item.result;
  const name = item.text.trim() || (item.textOnly ? 'Beschreibung' : 'Foto-Analyse');
  const label =
    item.status === 'pending'
      ? 'Wartet auf Verbindung'
      : item.status === 'analyzing'
        ? 'Wird analysiert…'
        : item.result
          ? `${item.result.items.length} Lebensmittel erkannt, bitte prüfen`
          : (item.error ?? 'Fehlgeschlagen');

  /** A paid result and its photos: gone only once the undo toast has passed. */
  async function discard() {
    const taken = await takeQueueItem(db, item.localId!);
    if (!taken) return;
    toast(`${name} gelöscht`, {
      action: { label: 'Rückgängig', onClick: () => void restoreQueueItem(db, taken) },
    });
  }

  return (
    <li>
      <SwipeToDelete label={`${name} löschen`} onDelete={() => void discard()}>
        <div className="flex min-h-14 items-center gap-3 px-4 py-2 select-none">
          <div className="relative size-12 shrink-0">
            <MealPhoto
              blob={first?.blob ?? null}
              blobKey={`aiPhoto:${item.localId}:${first?.id}`}
              alt=""
              className="size-12 rounded-lg"
            />
            <PhotoCount count={photos?.length ?? 0} />
            {item.status === 'analyzing' && (
              <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 text-white">
                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              className="block w-full min-w-0 rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default"
              disabled={!item.result}
              onClick={onOpen}
            >
              <div className={cn('truncate text-sm font-medium', failed && 'text-over')}>{label}</div>
              <div className="truncate text-xs text-muted-foreground">
                {fmtTime(item.createdAt)}
                {item.text ? ` · ${item.text}` : ''}
              </div>
            </button>
            {failed && (
              <button
                type="button"
                onClick={() => void retryQueueItem(db, item.localId!)}
                className="-my-1 rounded-md py-2 pr-3 text-sm font-medium text-primary underline underline-offset-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                Wiederholen
              </button>
            )}
          </div>
        </div>
      </SwipeToDelete>
    </li>
  );
}
