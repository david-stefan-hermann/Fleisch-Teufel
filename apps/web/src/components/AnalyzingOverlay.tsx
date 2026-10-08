import { Sparkles } from 'lucide-react';

const PHOTO_STEPS = ['Erkenne Lebensmittel', 'Schätze die Mengen', 'Suche Nährwerte heraus'] as const;

/**
 * Shown over a photo while Claude looks at it (meal photo, food label); pure CSS animation (see
 * `.ai-*` in index.css). The three steps cycle; they only set the mood, the call has no progress.
 */
export function AnalyzingOverlay({
  title = 'Analysiere Foto…',
  steps = PHOTO_STEPS,
}: {
  title?: string;
  steps?: readonly [string, string, string];
}) {
  return (
    <div
      role="status"
      className="absolute inset-0 grid place-items-center overflow-hidden rounded-xl bg-black/50 text-white"
    >
      <div className="ai-scan" aria-hidden />
      <div className="relative flex flex-col items-center gap-2 px-4 text-center">
        <Sparkles className="ai-pulse size-8" aria-hidden />
        <div className="text-lg font-semibold">{title}</div>
        <div className="ai-steps relative h-5 w-64 text-sm">
          {steps.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
