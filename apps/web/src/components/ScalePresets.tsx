import { Button } from '@/components/ui/button';
import { fmtPercent } from '@/lib/format';

/** Common factors for "Gesamtmenge" (half a plate left, a double portion), one tap instead of dragging. */
const PRESETS = [0.5, 0.75, 1, 1.5, 2];

export function ScalePresets({ value, onPick }: { value: number; onPick: (factor: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Gesamtmenge schnell wählen">
      {PRESETS.map((f) => (
        <Button
          key={f}
          type="button"
          size="sm"
          variant={Math.abs(value - f) < 0.001 ? 'default' : 'secondary'}
          onClick={() => onPick(f)}
        >
          {fmtPercent(f)}
        </Button>
      ))}
    </div>
  );
}
