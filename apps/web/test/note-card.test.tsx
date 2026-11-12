import { dayId, uuidv7 } from '@ft/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import { saveDayNote } from '@/db/notes';
import { NoteCard } from '@/features/diary/NoteCard';

vi.mock('@/app/session', () => ({ useDb: () => sessionDb }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));
let sessionDb: UserDb;
beforeEach(() => {
  sessionDb = new UserDb(`n-${uuidv7()}`);
});
afterEach(() => cleanup());

const DATE = '2026-11-10';

describe('NoteCard', () => {
  it('does not save text that was typed and taken back before the debounce', async () => {
    await saveDayNote(sessionDb, DATE, 'Gut');
    const before = (await sessionDb.dayNotes.get(dayId.note(DATE)))!.updatedAt;
    const view = render(<NoteCard date={DATE} />);
    const box = (await screen.findByLabelText('Tagesnotiz')) as HTMLTextAreaElement;
    expect(box.value).toBe('Gut');
    fireEvent.change(box, { target: { value: 'Gut geschlafen' } });
    fireEvent.change(box, { target: { value: 'Gut' } });
    // Leaving the day right away flushes what still waits.
    view.unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    const rec = await sessionDb.dayNotes.get(dayId.note(DATE));
    expect(rec?.note).toBe('Gut');
    expect(rec?.updatedAt).toBe(before);
  });

  it('saves typed text when the card goes away', async () => {
    await saveDayNote(sessionDb, DATE, 'Gut');
    const view = render(<NoteCard date={DATE} />);
    const box = (await screen.findByLabelText('Tagesnotiz')) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Gut geschlafen' } });
    view.unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });
    expect((await sessionDb.dayNotes.get(dayId.note(DATE)))?.note).toBe('Gut geschlafen');
  });
});
