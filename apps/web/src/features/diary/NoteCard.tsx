import { type DayNote, type ISODate } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { UserDb } from '@/db/dexie';
import { saveDayNote } from '@/db/notes';
import { useDayNote } from '@/hooks/data';
import { errorMessage } from '@/lib/api';
import { fmtTime } from '@/lib/format';

/** Longest note the schema accepts. */
export const NOTE_MAX_LENGTH = 5000;
const SAVE_DELAY_MS = 700;

export function NoteCard({ date }: { date: ISODate }) {
  const note = useDayNote(date);
  if (note === undefined) return null;
  return <NoteForm key={date} date={date} note={note} />;
}

/**
 * The note text is saved while typing (debounced) and in any case when the card goes away or the
 * app is hidden, so the last words of a note never get lost by switching the day or the app.
 * While nothing is typed the text follows the record (another device may edit it).
 */
function NoteForm({ date, note }: { date: ISODate; note: DayNote | null }) {
  const db = useDb();
  // null: not editing, the record's text shows. A string: typed here, waiting to be saved.
  const [local, setLocal] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const saved = note?.note ?? '';
  // The record caught up with what was typed: back to following it (a flush of the same text is a no-op).
  if (local !== null && local === saved) setLocal(null);
  const text = local ?? saved;

  useEffect(() => {
    if (local === null) return;
    pending.current = local;
    const t = setTimeout(() => void flush(db, date, pending), SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [local, db, date]);

  // Leaving the card (day change, navigation) or the app: save what is still waiting.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush(db, date, pending);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void flush(db, date, pending);
    };
  }, [db, date]);

  return (
    <Section title="Notiz">
      <div className="grid gap-3 px-4 pb-4">
        <Textarea
          aria-label="Tagesnotiz"
          placeholder="Wie lief der Tag? Hunger, Schlaf, Besonderheiten…"
          value={text}
          maxLength={NOTE_MAX_LENGTH}
          onChange={(e) => setLocal(e.target.value)}
          className="min-h-20"
        />
        {note?.completedAt ? (
          <Link
            to="/day/$date/complete"
            params={{ date }}
            className="flex items-center gap-2 text-sm text-good hover:underline"
          >
            <CheckCircle2 className="size-4" aria-hidden /> Tag abgeschlossen um {fmtTime(note.completedAt)}.
            Prognose ansehen
          </Link>
        ) : (
          <Button variant="secondary" asChild>
            <Link to="/day/$date/complete" params={{ date }}>
              <CheckCircle2 aria-hidden /> Tag abschließen
            </Link>
          </Button>
        )}
      </div>
    </Section>
  );
}

async function flush(db: UserDb, date: ISODate, pending: { current: string | null }): Promise<void> {
  const text = pending.current;
  if (text === null) return;
  pending.current = null;
  try {
    await saveDayNote(db, date, text);
  } catch (e) {
    pending.current = text;
    toast.error(errorMessage(e));
  }
}
