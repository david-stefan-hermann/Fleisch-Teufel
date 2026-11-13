import { Link, useNavigate, useRouter, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Keyboard, LoaderCircle, Search, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDb } from '@/app/session';
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay';
import { DayNote } from '@/components/DayNote';
import { HeaderMealPicker } from '@/components/HeaderMealPicker';
import { Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { QuickEntryFields, quickEntryHasText, quickEntryValid } from '@/features/foods/QuickEntryFields';
import { useSettings } from '@/hooks/data';
import { endpoints } from '@/lib/api';
import { goBackOr } from '@/lib/history';
import { CameraCapture } from './CameraStep';
import { PhotoPreview } from './PreviewStep';
import { processQueue } from './queue';
import { QueueList } from './QueueList';
import { ResultEditor } from './ReviewStep';
import { usePhotoFlow } from './usePhotoFlow';

/**
 * "Essen eintragen": camera for barcodes and plate photos; below it "Eingeben" (text and values
 * instead of a photo, `form` in the URL) and "Suchen" (the food search for the same meal). Plate
 * photos first show a preview with the optional hint, where more photos can be added (further
 * plates, courses, a label); only "Analysieren" sends them to Claude, in one call.
 *
 * "Eingeben" is one form for two things: values alone are logged as a quick entry ("Eintragen"), a
 * text alone is analysed ("Analysieren"), with both the person chooses (the values then go to the
 * AI as a clue).
 *
 * A finished analysis opens its review (`review` in the URL), but only while the person waits for it
 * here: leaving during the analysis (back arrow, swipe, another page) goes to the diary, and the
 * result is logged there by itself (`leaveAnalysis`).
 */
export function PhotoPage() {
  const search = useSearch({ from: '/authed/photo' });
  const { date, review, form = false } = search;
  const navigate = useNavigate({ from: '/photo' });
  // The meal picked in the header wins over the one of the link. It is written into the URL of
  // whichever step of this page shows (camera, form), so the search, the scanner and the way back
  // from them know it too.
  const [picked, setPicked] = useState<number | null>(null);
  const meal = picked ?? search.meal;
  useEffect(() => {
    if (picked !== null && picked !== search.meal)
      void navigate({ search: (s) => ({ ...s, meal: picked }), replace: true });
  }, [picked, search.meal, navigate]);
  const router = useRouter();
  const db = useDb();
  const settings = useSettings();
  const queue = useLiveQuery(() => db.aiQueue.orderBy('createdAt').reverse().toArray(), [db]);
  // The open analysis lives in the URL, so returning from the food search lands in it again.
  // From "Eingeben" the review takes the place of the finished form in the history.
  const openReview = (id: number, replace = false) =>
    void navigate({ search: (s) => ({ ...s, review: id, form: undefined }), replace });
  const openForm = () => void navigate({ search: (s) => ({ ...s, form: true as const }) });
  /** Leaves "Eingeben" for the camera it was opened from. */
  const closeForm = () =>
    goBackOr(
      router.history,
      1,
      () => void navigate({ search: (s) => ({ ...s, form: undefined }), replace: true }),
    );
  // Closing goes back to the page that opened the review (the camera with its list), so that one
  // more "back" leaves the food page instead of showing it a second time.
  const closeReview = () =>
    goBackOr(
      router.history,
      1,
      () => void navigate({ search: (s) => ({ ...s, review: undefined }), replace: true }),
    );
  const activeId = review ?? null;
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const flow = usePhotoFlow({ date, meal, openReview, closeForm });
  const { shots, adding, analyzing, logging, entry } = flow;

  useEffect(() => {
    endpoints.aiStatus().then(
      (s) => setAiEnabled(s.enabled),
      () => setAiEnabled(null),
    );
    void processQueue(db);
  }, [db]);

  const active = queue?.find((q) => q.localId === activeId);
  // The review stays while a re-analysis runs; a new key once it is done loads the new rows.
  if (active?.result) {
    const busy = active.status === 'pending' || active.status === 'analyzing';
    return (
      <ResultEditor
        key={`${active.localId}:${busy ? 'busy' : 'idle'}`}
        item={active}
        busy={busy}
        onClose={closeReview}
      />
    );
  }

  const preview = shots.length > 0;
  const typing = form && !preview;
  // The AI may be off on the server; unknown (offline) still queues the description for later.
  const canAnalyze = aiEnabled !== false && quickEntryHasText(entry);
  const canLog = quickEntryValid(entry);
  const busy = analyzing || adding || logging;
  const analyzeLabel = analyzing ? (
    <>
      <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden /> Wird analysiert…
    </>
  ) : shots.length > 1 ? (
    `Analysieren (${shots.length} Fotos)`
  ) : (
    'Analysieren'
  );
  return (
    <Page
      title="Essen eintragen"
      back
      // The meal everything on this page logs into (photo, form, search, barcode), changed right here.
      actions={
        <HeaderMealPicker
          meal={meal}
          names={settings?.mealNames ?? []}
          onChange={setPicked}
          disabled={busy}
        />
      }
      // In the preview, back drops the photos and returns to the camera; during the analysis it
      // leaves for the diary. The form is a step of its own in the history: back is the camera.
      onBack={analyzing ? flow.leaveToDiary : preview ? flow.clearShots : undefined}
      withTabBar={false}
      footer={
        preview ? (
          <Button size="lg" form="photo-preview" type="submit" disabled={busy}>
            {analyzeLabel}
          </Button>
        ) : typing ? (
          // Values alone: "Eintragen". A text alone: "Analysieren". Both: both, logging first.
          canAnalyze && canLog ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant="outline" disabled={busy} onClick={() => void flow.describeMeal()}>
                {analyzeLabel}
              </Button>
              <Button size="lg" disabled={busy} onClick={flow.logEntry}>
                Eintragen
              </Button>
            </div>
          ) : canAnalyze ? (
            <Button size="lg" disabled={busy} onClick={() => void flow.describeMeal()}>
              {analyzeLabel}
            </Button>
          ) : (
            <Button size="lg" disabled={busy || !canLog} onClick={flow.logEntry}>
              Eintragen
            </Button>
          )
        ) : undefined
      }
    >
      <DayNote date={date} />
      {preview ? (
        <PhotoPreview
          shots={shots}
          busy={analyzing}
          adding={adding}
          onAdd={(blobs) => void flow.addShots(blobs)}
          onRemove={flow.removeShot}
          onAnalyze={(text) => void flow.analyze(text)}
        />
      ) : typing ? (
        <div className="grid gap-3">
          <QuickEntryFields
            value={entry}
            onChange={flow.setEntry}
            disabled={analyzing || logging}
            autoFocus
            hint={
              analyzing
                ? 'Du kannst zurück ins Tagebuch gehen. Das Ergebnis wird dort eingetragen.'
                : aiEnabled === false
                  ? 'Der Text steht als Titel im Tagebuch. Eingetragen werden die Werte, die du angibst.'
                  : undefined
            }
          />
          {analyzing && (
            <div className="relative h-28 overflow-hidden rounded-2xl border border-border/70 bg-muted">
              <AnalyzingOverlay
                title="Analysiere Beschreibung…"
                steps={['Lese die Beschreibung', 'Suche die Lebensmittel', 'Schätze die Mengen']}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          {aiEnabled === false && (
            <p role="alert" className="mb-4 flex gap-2 rounded-xl bg-warn/10 p-3 text-sm">
              <TriangleAlert className="size-5 shrink-0 text-warn" aria-hidden />
              KI-Analyse auf dem Server ausgeschaltet
            </p>
          )}
          <CameraCapture
            busy={adding}
            onShots={(blobs) => void flow.addShots(blobs)}
            // A page of its own: back from the product returns to the camera.
            onBarcode={(code) => void navigate({ to: '/scan', search: { date, meal, code } })}
          />
          {/* The two other ways to log, where the thumb is: typing it in, or the food search. */}
          <div data-ai-avoid className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" disabled={analyzing} onClick={openForm}>
              <Keyboard aria-hidden /> Eingeben
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link to="/add" search={{ date, meal }}>
                <Search aria-hidden /> Suchen
              </Link>
            </Button>
          </div>
          {queue && queue.length > 0 && <QueueList queue={queue} onOpen={(id) => openReview(id)} />}
        </>
      )}
    </Page>
  );
}
