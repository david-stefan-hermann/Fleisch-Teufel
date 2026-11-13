/**
 * Mehr → Aussehen, section "Assistent": whether the floating button shows (the add sheet always has
 * it), its size and its figure (standard, the built-in ones, uploaded packs). The choice is per device.
 */
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Section } from '@/components/Page';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  setAssistantButton,
  setAssistantSize,
  setAssistantSkin,
  useAppearance,
  type AssistantSize,
} from '@/lib/appearance';
import { cn } from '@/lib/utils';
import { initialState } from '../machine';
import { BUILTIN_SKINS } from './builtin';
import { SkinFace, STANDARD_SKIN, type SkinView } from './SkinFace';
import { builtinView } from './useSkin';

/** The button at rest, as a picture on a tile. */
export function SkinPreview({ skin }: { skin: SkinView }) {
  return (
    <span
      className="ai-btn ai-still"
      data-skin={skin.id}
      data-style={skin.style}
      data-state="idle"
      data-edge="right"
    >
      <SkinFace skin={skin} state={initialState} warn={false} />
    </span>
  );
}

export function SkinTile({
  skin,
  selected,
  onSelect,
  children,
}: {
  skin: SkinView;
  selected: boolean;
  onSelect: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'grid w-full min-w-0 justify-items-center gap-3 rounded-xl border border-border px-1.5 pt-4 pb-2.5 text-xs font-semibold',
          selected && 'border-primary ring-1 ring-primary',
        )}
      >
        <span className="grid h-16 place-items-center">
          <SkinPreview skin={skin} />
        </span>
        <span className="hyphens-auto">{skin.name}</span>
      </button>
      {children}
    </div>
  );
}

const SIZES: { value: AssistantSize; label: string }[] = [
  { value: 'small', label: 'Klein' },
  { value: 'medium', label: 'Mittel' },
  { value: 'large', label: 'Groß' },
];

export function AssistantAppearance({ uploads }: { uploads?: ReactNode }) {
  const a = useAppearance();
  const skins = [STANDARD_SKIN, ...BUILTIN_SKINS.map(builtinView)];
  return (
    <Section title="Assistent">
      <div className="flex min-h-14 items-center gap-3 px-4 py-2">
        <label htmlFor="assistant-button" className="min-w-0 flex-1 font-medium">
          Schwebender Knopf
        </label>
        <Switch id="assistant-button" checked={a.assistantButton} onCheckedChange={setAssistantButton} />
      </div>
      <div className="border-t border-border/70 px-4 py-3">
        <ToggleGroup
          type="single"
          variant="outline"
          value={a.assistantSize}
          onValueChange={(v) => v && setAssistantSize(v as AssistantSize)}
          className="w-full"
          aria-label="Größe des Knopfs"
        >
          {SIZES.map((sz) => (
            <ToggleGroupItem key={sz.value} value={sz.value} className="h-12 flex-1">
              {sz.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-3 gap-2.5 border-t border-border/70 p-3.5">
        {skins.map((s) => (
          <SkinTile
            key={s.id}
            skin={s}
            selected={a.assistantSkin === s.id}
            onSelect={() => setAssistantSkin(s.id)}
          />
        ))}
        {uploads}
      </div>
    </Section>
  );
}

export function AddSkinTile({ onPick, busy }: { onPick: (file: File) => void; busy: boolean }) {
  return (
    <label
      className={cn(
        'grid cursor-pointer justify-items-center gap-3 rounded-xl border border-border px-1.5 pt-4 pb-2.5 text-center text-xs font-semibold',
        busy && 'pointer-events-none opacity-50',
      )}
    >
      <span className="grid size-14 place-items-center rounded-full border-2 border-dashed border-input text-muted-foreground">
        <Plus className="size-5" aria-hidden />
      </span>
      Eigene Figur
      <input
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onPick(f);
        }}
      />
    </label>
  );
}
