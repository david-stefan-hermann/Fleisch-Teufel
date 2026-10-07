import { dayId, type ISODate } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useDb } from '@/app/session';
import { Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { saveRecord } from '@/db/write';
import { useDayNote } from '@/hooks/data';
import { fmtTime } from '@/lib/format';

export function NoteCard({ date }: { date: ISODate }) {
  const db = useDb();
  const note = useDayNote(date);
  const [text, setText] = useState('');
  const dirty = useRef(false);
  useEffect(() => {
    if (note !== undefined && !dirty.current) setText(note?.note ?? '');
  }, [note]);

  // Debounced autosave.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      dirty.current = false;
      void saveRecord(db, 'dayNotes', {
        id: dayId.note(date),
        date,
        note: text,
        completedAt: note?.completedAt ?? null,
      });
    }, 700);
    return () => clearTimeout(t);
  }, [text, db, date, note?.completedAt]);

  return (
    <Section title="Notiz">
      <div className="grid gap-3 px-4 pb-4">
        <Textarea
          aria-label="Tagesnotiz"
          placeholder="Wie lief der Tag? Hunger, Schlaf, Besonderheiten…"
          value={text}
          onChange={(e) => {
            dirty.current = true;
            setText(e.target.value);
          }}
          className="min-h-20"
        />
        {note?.completedAt ? (
          <Link
            to="/day/$date/complete"
            params={{ date }}
            className="flex items-center gap-2 text-sm text-good hover:underline"
          >
            <CheckCircle2 className="size-4" aria-hidden /> Tag abgeschlossen um {fmtTime(note.completedAt)} –
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
