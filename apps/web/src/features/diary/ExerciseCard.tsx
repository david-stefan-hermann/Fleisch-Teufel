import { formatDuration, groupTrainingEntries, INTENSITY_LABELS_DE, shortSportName } from '@ft/shared';
import type { ExerciseEntry, ISODate } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDown, Dumbbell, Plus } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { UserDb } from '@/db/dexie';
import { deleteRecord, restoreRecord } from '@/db/write';
import { trainingTitle, useTrainingNames } from '@/features/exercise/training';
import { TrainingSuggestions } from '@/features/exercise/TrainingSuggestions';
import { fmt0 } from '@/lib/format';
import { useRememberLogStart } from '@/lib/logFlow';
import { cn } from '@/lib/utils';

/**
 * The diary's training card, like a diary meal: header with the total, rows (a single training, or
 * the activities of a saved training logged together as one row that opens), swipe left deletes
 * (a package as a whole), "Zuletzt & häufig" below. A tap on a training opens it on its sport page.
 */
export function ExerciseCard({
  date,
  exercises,
  credited,
  headerAction,
  leadingChips,
  onCopy,
}: {
  date: ISODate;
  exercises: ExerciseEntry[];
  credited: boolean;
  /** Before the "+" (the paste button while a training is copied). */
  headerAction?: ReactNode;
  /** Chips before the suggestions ("Wie gestern"). */
  leadingChips?: ReactNode;
  /** Swipe right copies a row (a training or a package). */
  onCopy?: (title: string, entries: ExerciseEntry[]) => void;
}) {
  const db = useDb();
  const rememberStart = useRememberLogStart();
  const names = useTrainingNames();
  const total = exercises.reduce((s, e) => s + e.kcal, 0);
  const rows = groupTrainingEntries(exercises);
  return (
    <Section
      title={
        <span className="flex items-baseline gap-2">
          Training
          {total > 0 && (
            <span className="tabular text-sm font-normal text-muted-foreground">{fmt0(total)} kcal</span>
          )}
          {!credited && exercises.length > 0 && (
            <Badge variant="secondary" className="self-center px-1.5 py-0 text-[11px] font-normal">
              nicht angerechnet
            </Badge>
          )}
        </span>
      }
      action={
        <div className="flex items-center gap-1">
          {headerAction}
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/exercise"
              search={{ date }}
              onClick={() => rememberStart(date)}
              aria-label="Training eintragen"
            >
              <Plus className="size-5 text-primary" aria-hidden />
            </Link>
          </Button>
        </div>
      }
    >
      {exercises.length === 0 ? (
        <>
          <Link
            to="/exercise"
            search={{ date }}
            onClick={() => rememberStart(date)}
            className="mx-4 mb-4 flex h-11 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <Dumbbell className="size-4" aria-hidden /> Training eintragen
          </Link>
          <TrainingSuggestions date={date} leading={leadingChips} />
        </>
      ) : (
        <ul className="divide-y divide-border/70">
          {rows.map((row) => {
            if (row.kind === 'entry') {
              const e = row.entry;
              const { title, sport } = trainingTitle(e, names);
              return (
                <li key={e.id} data-row={e.id}>
                  <SwipeToDelete
                    label={`${title} löschen`}
                    onDelete={() => void removeTrainingsWithUndo(db, [e], title)}
                    onCopy={onCopy && (() => onCopy(title, [e]))}
                  >
                    <EntryLink entry={e}>
                      <ExerciseRowBody entry={e} title={title} sport={sport} />
                    </EntryLink>
                  </SwipeToDelete>
                </li>
              );
            }
            const title = trainingGroupTitle(row.templateId, row.entries, names);
            return (
              <li
                key={row.groupId}
                data-row={`group:${row.groupId}`}
                data-rows={row.entries.map((e) => e.id).join(' ')}
              >
                <TrainingGroupRow
                  title={title}
                  entries={row.entries}
                  onDelete={() => void removeTrainingsWithUndo(db, row.entries, title)}
                  onCopy={onCopy && (() => onCopy(title, row.entries))}
                />
              </li>
            );
          })}
        </ul>
      )}
      {exercises.length > 0 && <TrainingSuggestions date={date} className="border-t border-border/70 pt-3" />}
    </Section>
  );
}

/** The title of a logged package: the saved training's current name, else its sports. */
export function trainingGroupTitle(
  templateId: string | null,
  entries: readonly Pick<ExerciseEntry, 'name'>[],
  names: ReadonlyMap<string, string> | undefined,
): string {
  return (templateId && names?.get(templateId)) || entries.map((e) => shortSportName(e.name)).join(' · ');
}

/** "2 Aktivitäten · 1 Std. 15 Min.". */
export const activitiesLabel = (entries: readonly Pick<ExerciseEntry, 'minutes'>[]) =>
  `${fmt0(entries.length)} ${entries.length === 1 ? 'Aktivität' : 'Aktivitäten'} · ${formatDuration(
    entries.reduce((s, e) => s + e.minutes, 0),
  )}`;

function EntryLink({
  entry,
  className,
  children,
}: {
  entry: ExerciseEntry;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to="/exercise-entry/$entryId"
      params={{ entryId: entry.id }}
      draggable={false}
      className={cn(
        'flex min-h-14 items-center gap-3 px-4 py-2 transition-colors select-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** A logged package: one row with its title, "N Aktivitäten · 75 Min. ⌄" opens the activities. */
function TrainingGroupRow({
  title,
  entries,
  onDelete,
  onCopy,
}: {
  title: string;
  entries: ExerciseEntry[];
  onDelete: () => void;
  onCopy?: () => void;
}) {
  const db = useDb();
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <SwipeToDelete label={`${title} löschen`} onDelete={onDelete} onCopy={onCopy}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors select-none hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
        >
          <TrainingGroupRowBody title={title} entries={entries} open={open} />
        </button>
      </SwipeToDelete>
      {open && (
        <ul
          id={listId}
          className="border-t border-border/70 bg-muted/40"
          aria-label={`Aktivitäten von ${title}`}
        >
          {entries.map((e) => (
            <li key={e.id} className="border-b border-border/50 last:border-b-0">
              <SwipeToDelete
                label={`${e.name} löschen`}
                onDelete={() => void removeTrainingsWithUndo(db, [e], e.name)}
              >
                <EntryLink entry={e} className="min-h-12 pl-10 text-sm">
                  <ExerciseRowBody entry={e} title={e.name} sport={null} />
                </EntryLink>
              </SwipeToDelete>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Content of a package row (also in the shared day image, closed): title, activities and duration, kcal. */
export function TrainingGroupRowBody({
  title,
  entries,
  open,
}: {
  title: string;
  entries: readonly ExerciseEntry[];
  /** Shows the arrow (the diary); without it the row is static (day image). */
  open?: boolean;
}) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          {activitiesLabel(entries)}
          {open !== undefined && (
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          )}
        </div>
      </div>
      <div className="tabular font-semibold text-exercise">
        +{fmt0(entries.reduce((s, e) => s + e.kcal, 0))}
      </div>
    </>
  );
}

/** Deletes trainings in one transaction, with undo for exactly these. */
export async function removeTrainingsWithUndo(db: UserDb, list: readonly ExerciseEntry[], title: string) {
  const ids = list.map((e) => e.id);
  await db.transaction('rw', [db.exerciseEntries, db.outbox], async () => {
    for (const id of ids) await deleteRecord(db, 'exerciseEntries', id);
  });
  toast(`${title} gelöscht`, {
    action: {
      label: 'Rückgängig',
      onClick: () => void Promise.all(ids.map((id) => restoreRecord(db, 'exerciseEntries', id))),
    },
  });
}

/**
 * Content of a training row (also in the shared day image): the title (`trainingTitle`: the saved
 * training's name, else the sport), then sport (only under a saved training's name) · duration ·
 * intensity · note, and the kcal.
 */
export function ExerciseRowBody({
  entry: e,
  title,
  sport,
}: {
  entry: ExerciseEntry;
  title: string;
  sport: string | null;
}) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {[sport, formatDuration(e.minutes), INTENSITY_LABELS_DE[e.intensity], e.note]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      <div className="tabular font-semibold text-exercise">+{fmt0(e.kcal)}</div>
    </>
  );
}
