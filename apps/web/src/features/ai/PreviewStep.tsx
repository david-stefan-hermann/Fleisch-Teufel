import { MAX_ANALYSIS_PHOTOS, MAX_HINT_LENGTH } from '@ft/shared';
import { useState } from 'react';
import { AnalyzingOverlay } from '@/components/AnalyzingOverlay';
import { warmUpCamera } from '@/components/cameraWarmup';
import { HintCount, HintField } from '@/components/HintField';
import { PhotoCaptureSheet } from '@/components/PhotoCaptureSheet';
import { PhotoStrip } from '@/components/PhotoStrip';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { IMAGE_PRESETS } from './image';
import { addLabel, HINT_CHIPS, type CapturedShot } from './types';

/**
 * Taken or picked photos before they go to the AI: the photo strip (X removes one, the last X goes
 * back to the camera, "+" adds more through `PhotoCaptureSheet`) and the optional hint. "Analysieren"
 * (page footer, submits this form) queues and analyzes them.
 */
export function PhotoPreview({
  shots,
  busy,
  adding,
  onAdd,
  onRemove,
  onAnalyze,
}: {
  shots: CapturedShot[];
  /** Analysis running (state of the page: its footer button is disabled meanwhile). */
  busy: boolean;
  /** Photos being compressed. */
  adding: boolean;
  onAdd: (photos: Blob[]) => void;
  onRemove: (id: number) => void;
  onAnalyze: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(false);
  const room = MAX_ANALYSIS_PHOTOS - shots.length;

  return (
    <form
      id="photo-preview"
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onAnalyze(text);
      }}
    >
      <PhotoStrip
        photos={shots.map((s) => ({ key: `shot:${s.id}`, blob: s.blob, removable: true }))}
        alt={shots.length > 1 ? 'Gewähltes Foto' : 'Aufgenommenes Foto'}
        max={MAX_ANALYSIS_PHOTOS}
        busy={busy || adding}
        addLabel="Fotos hinzufügen"
        onAdd={() => {
          warmUpCamera();
          setSheet(true);
        }}
        onRemove={(key) => onRemove(Number(key.slice('shot:'.length)))}
      >
        {busy && <AnalyzingOverlay />}
      </PhotoStrip>
      <div className="grid gap-1.5">
        <Label htmlFor="ai-text">Hinweis für die Analyse (optional)</Label>
        <HintField
          id="ai-text"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          placeholder="z. B. „mit Butter gebraten“, „halbe Portion“, „250 g Hähnchen“…"
          aria-describedby="ai-text-hint"
        />
        {!busy && (
          <div className="flex flex-wrap gap-2" aria-label="Häufige Hinweise">
            {HINT_CHIPS.map((chip) => (
              <Button
                key={chip}
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 rounded-full"
                onClick={() =>
                  setText((t) => (t.trim() ? `${t.trim()}, ${chip}` : chip).slice(0, MAX_HINT_LENGTH))
                }
              >
                {chip}
              </Button>
            ))}
          </div>
        )}
        <p id="ai-text-hint" className="text-xs text-muted-foreground">
          <HintCount length={text.length} />
          {busy && 'Du kannst zurück ins Tagebuch gehen. Das Ergebnis wird dort eingetragen.'}
        </p>
      </div>
      {sheet && (
        <PhotoCaptureSheet
          title="Fotos hinzufügen"
          max={room}
          preset={IMAGE_PRESETS.analysis}
          footerLabel={addLabel}
          hint={`Weitere Teller, Gänge oder die Nährwerttabelle, bis zu ${MAX_ANALYSIS_PHOTOS} Fotos insgesamt`}
          onSubmit={(photos) => {
            setSheet(false);
            onAdd(photos);
          }}
          onClose={() => setSheet(false)}
        />
      )}
    </form>
  );
}
