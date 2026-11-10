import type { ExerciseEntry } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { Footprints } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { fmt0, fmt1 } from '@/lib/format';

/** "6,1 km" from meters. */
export const fmtKm = (m: number) => `${fmt1(m / 1000)} km`;

/**
 * Content of the steps row (also in the shared day image): green footprints, "8.432 Schritte", the
 * distance (and "nicht angerechnet" when steps do not count), the refresh slot, the kcal.
 */
export function StepsRowBody({
  entry,
  credited,
  title,
  refresh,
}: {
  entry: ExerciseEntry;
  credited: boolean;
  /** The title, a stretched link in the diary; plain text in the day image. */
  title?: ReactNode;
  refresh?: ReactNode;
}) {
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-steps/15 text-steps">
        <Footprints className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="tabular truncate font-medium">{title ?? stepsTitle(entry)}</div>
        <div className="tabular flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span>{entry.distanceM !== null ? fmtKm(entry.distanceM) : 'ohne Strecke'}</span>
          {!credited && (
            <Badge variant="secondary" className="px-1.5 py-0 text-[11px] font-normal">
              nicht angerechnet
            </Badge>
          )}
        </div>
      </div>
      {refresh}
      <div className="tabular font-semibold text-steps">+{fmt0(entry.kcal)}</div>
    </>
  );
}

export const stepsTitle = (entry: Pick<ExerciseEntry, 'steps'>) => `${fmt0(entry.steps ?? 0)} Schritte`;

/** The diary's steps row: a stretched link to the steps page, with room for ↻ above it. */
export function StepsRow({
  entry,
  credited,
  refresh,
}: {
  entry: ExerciseEntry;
  credited: boolean;
  refresh?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-14 w-full items-center gap-3 px-4 py-2 transition-colors select-none hover:bg-accent/60 has-[a:focus-visible]:bg-accent">
      <StepsRowBody
        entry={entry}
        credited={credited}
        refresh={refresh && <div className="relative z-10 -my-2">{refresh}</div>}
        title={
          <Link
            to="/steps/$date"
            params={{ date: entry.date }}
            draggable={false}
            className="after:absolute after:inset-0 focus-visible:outline-none"
          >
            {stepsTitle(entry)}
          </Link>
        }
      />
    </div>
  );
}
