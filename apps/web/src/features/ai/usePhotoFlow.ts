import { MAX_ANALYSIS_PHOTOS } from '@ft/shared';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { logQuickEntry } from '@/db/entries';
import {
  emptyQuickEntry,
  quickEntryHasText,
  quickEntryValid,
  quickEntryValues,
  type QuickEntryState,
} from '@/features/foods/QuickEntryFields';
import { useSubmitting } from '@/hooks/useSubmitting';
import { errorMessage } from '@/lib/api';
import { fmt0 } from '@/lib/format';
import { useReturnToDiary } from '@/lib/logFlow';
import { compressImage, IMAGE_PRESETS } from './image';
import { enqueueDescription, enqueuePhotos, leaveAnalysis, processQueue } from './queue';
import type { CapturedShot } from './types';

/**
 * State and actions of the food page ("Essen eintragen") apart from its URL: the photos of the
 * preview, the "Eingeben" form, and the analysis the page waits for.
 *
 * Contract of the waiting: `waiting` holds the queue item the page waits for, `gone` says the page
 * was left. Both are refs because they are read after awaits, where the component may be gone (state
 * would be stale there). After an await, navigate only when `waiting.current === id && !gone.current`;
 * otherwise the analysis was handed over to the diary (`leaveAnalysis`) and is logged there by itself.
 */
export function usePhotoFlow({
  date,
  meal,
  openReview,
  closeForm,
}: {
  date: string;
  meal: number;
  /** Opens the review of a queue item; `replace` puts it in place of the form in the history. */
  openReview: (id: number, replace?: boolean) => void;
  /** Leaves "Eingeben" for the camera it was opened from. */
  closeForm: () => void;
}) {
  const db = useDb();
  const returnToDiary = useReturnToDiary();
  // Photos waiting for "Analysieren" (preview), already compressed. Leaving the page drops them.
  const [shots, setShots] = useState<CapturedShot[]>([]);
  const nextShot = useRef(1);
  const [analyzing, setAnalyzing] = useState(false);
  const [adding, setAdding] = useState(false);
  // "Eingeben": what was typed stays while the person looks at the camera again.
  const [entry, setEntry] = useState<QuickEntryState>(emptyQuickEntry);
  // The queue item the preview waits for, and whether the page was left meanwhile.
  const waiting = useRef<number | null>(null);
  const gone = useRef(false);

  // Leaving the page while the analysis runs (swipe, browser back, a header link): it is logged by
  // itself. StrictMode runs this cleanup once on mount, when nothing waits yet.
  useEffect(() => {
    gone.current = false;
    return () => {
      gone.current = true;
      const id = waiting.current;
      waiting.current = null;
      if (id !== null) void leaveAnalysis(db, id);
    };
  }, [db]);

  /** Back arrow during the analysis: straight to the diary, the result is logged there. */
  function leaveToDiary() {
    const id = waiting.current;
    waiting.current = null;
    if (id !== null) void leaveAnalysis(db, id);
    void returnToDiary({ date, focus: { rows: id === null ? [] : [`pending:${id}`], meal } });
  }

  /** Compresses taken or picked photos and adds them to the preview. */
  async function addShots(blobs: Blob[]) {
    setAdding(true);
    const added: CapturedShot[] = [];
    for (const blob of blobs) {
      try {
        added.push({ id: nextShot.current++, blob: await compressImage(blob, IMAGE_PRESETS.analysis) });
      } catch {
        toast.error('Das Bild konnte nicht gelesen werden. Versuche ein anderes Foto.');
      }
    }
    setAdding(false);
    setShots((s) => [...s, ...added].slice(0, MAX_ANALYSIS_PHOTOS));
  }

  /** Queues the preview photos with the hint and waits for the result. */
  async function analyze(text: string) {
    if (analyzing || shots.length === 0) return;
    await follow(meal, false, () =>
      enqueuePhotos(
        db,
        { date, meal, text },
        shots.map((s) => s.blob),
      ),
    );
  }

  /**
   * "Analysieren" of the form: queues the description (no photo) for the meal and waits for
   * the result. Typed values go along as a clue; the review shows what the AI found.
   */
  async function describeMeal() {
    if (analyzing || !quickEntryHasText(entry)) return;
    const typed = {
      kcal: entry.kcal ?? undefined,
      proteinG: entry.protein ?? undefined,
      carbsG: entry.carbs ?? undefined,
      fatG: entry.fat ?? undefined,
    };
    await follow(meal, true, () => enqueueDescription(db, { date, meal, text: entry.text, typed }));
  }

  const { busy: logging, run } = useSubmitting();
  /** "Eintragen" of the form: a quick entry with the typed values; the text is its note and title. */
  async function logEntry() {
    if (!quickEntryValid(entry)) return;
    const values = quickEntryValues(entry, meal);
    const id = await logQuickEntry(db, date, values);
    toast.success(`${fmt0(values.kcal)} kcal eingetragen`);
    await returnToDiary({ date, focus: { rows: [id], meal: values.meal } });
  }

  /**
   * Queues an analysis and waits for it while the person stays here: a finished one opens its review,
   * an offline one goes to the diary as a placeholder, a failed one says so.
   */
  async function follow(toMeal: number, fromForm: boolean, enqueue: () => Promise<number>) {
    setAnalyzing(true);
    let id: number;
    try {
      id = await enqueue();
    } catch (e) {
      // Only storing can fail here; the analysis itself reports through the queue item.
      toast.error(errorMessage(e));
      setAnalyzing(false);
      return;
    }
    try {
      if (gone.current) return void leaveAnalysis(db, id);
      waiting.current = id;
      // The preview stays (with its overlay and the hint) while the analysis runs; `analyzing`
      // keeps its button inactive, so the photos cannot be queued a second time.
      await processQueue(db);
      // Left meanwhile (or handed over): never navigate from here any more.
      if (waiting.current !== id) return;
      const item = await db.aiQueue.get(id);
      // Left during the read: the result goes to the diary by itself.
      if (waiting.current !== id || gone.current) return void leaveAnalysis(db, id);
      waiting.current = null;
      // Stored and analysed: the preview (or the form) is done, whatever the outcome.
      setShots([]);
      if (fromForm) setEntry(emptyQuickEntry());
      if (item?.status === 'done' && !item.deferred) return openReview(id, fromForm);
      if (item?.status === 'pending') {
        // Offline: the photos are safe and already show in the diary; logged once analysed.
        toast(
          item?.textOnly
            ? 'Offline gespeichert. Die Beschreibung steht im Tagebuch und wird analysiert, sobald du wieder verbunden bist.'
            : 'Offline gespeichert. Das Foto steht im Tagebuch und wird analysiert, sobald du wieder verbunden bist.',
        );
        return void returnToDiary({ date, focus: { rows: [`pending:${id}`], meal: toMeal } });
      }
      if (item?.status === 'failed') toast.error(item.error ?? 'Analyse fehlgeschlagen');
      // The description waits under "Offene Analysen" now (to repeat or discard), not in the form.
      if (fromForm) closeForm();
    } finally {
      setAnalyzing(false);
    }
  }

  return {
    /** Photos of the preview. */
    shots,
    /** Photos being compressed. */
    adding,
    /** An analysis was queued and the page waits for it. */
    analyzing,
    /** The quick entry being logged ("Eintragen" of the form). */
    logging,
    entry,
    setEntry,
    addShots,
    removeShot: (id: number) => setShots((s) => s.filter((x) => x.id !== id)),
    clearShots: () => setShots([]),
    analyze,
    describeMeal,
    logEntry: () => void run(logEntry),
    leaveToDiary,
  };
}
