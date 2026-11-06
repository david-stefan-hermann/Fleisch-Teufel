import { ClipboardList, ClipboardX, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { SaveMealDialog } from '@/components/SaveMealDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  clearClipboard,
  clipboardKcal,
  CLIPBOARD_KEY,
  foodClipboard,
  type AnyClipboard,
} from '@/db/clipboard';
import { describe } from '@/features/exercise/training';
import { saveMealFromItems } from '@/db/entries';
import { fmt0, fmtIngredients } from '@/lib/format';
import { entryAmountLabel } from './MealCard';

/**
 * The clipboard icon in the diary header (only while something is copied): what is copied, "Als Meal
 * speichern" for a copied group (e.g. a scanned meal) or diary meal and "Zwischenablage leeren".
 */
export function ClipboardMenu({ clipboard }: { clipboard: AnyClipboard }) {
  const db = useDb();
  const [saveOpen, setSaveOpen] = useState(false);
  const detail = clipboardDetail(clipboard);
  const food = foodClipboard(clipboard);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Zwischenablage" className="text-muted-foreground">
            <ClipboardList aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>
            <span className="block text-xs font-normal text-muted-foreground">Kopiert</span>
            <span className="block truncate">{clipboard.name}</span>
            <span className="tabular block text-xs font-normal text-muted-foreground">{detail}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {food && food.kind !== 'entry' && (
            <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
              <Save aria-hidden /> Als Meal speichern
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() =>
              void clearClipboard(db).then(() =>
                toast('Zwischenablage geleert', {
                  action: {
                    label: 'Rückgängig',
                    onClick: () => void db.kv.put({ key: CLIPBOARD_KEY, value: clipboard }),
                  },
                }),
              )
            }
          >
            <ClipboardX aria-hidden /> Zwischenablage leeren
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {food && (
        <SaveMealDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          count={food.items.length}
          defaultName={food.name}
          onConfirm={async (name) => {
            await saveMealFromItems(db, name, food.items, food.photoIds[0] ?? null);
            toast.success(`„${name}“ gespeichert`);
          }}
        />
      )}
    </>
  );
}

/** The line under the copied name: kcal and how many entries, ingredients, activities or the amount. */
function clipboardDetail(clip: AnyClipboard): string {
  if (clip.kind === 'training') {
    const kcal = clip.parts.reduce((s, p) => s + p.kcal, 0);
    const n = clip.parts.length;
    return [
      `${fmt0(kcal)} kcal`,
      n === 1
        ? describe(null, clip.parts[0]!.minutes, clip.parts[0]!.intensity, null)
        : `${fmt0(n)} Aktivitäten`,
    ].join(' · ');
  }
  const first = clip.items[0];
  const rows = clip.parts?.length ?? 0;
  return [
    `${fmt0(clipboardKcal(clip))} kcal`,
    clip.kind === 'meal'
      ? `${fmt0(rows)} ${rows === 1 ? 'Eintrag' : 'Einträge'}`
      : clip.kind === 'group'
        ? fmtIngredients(clip.items.length)
        : first
          ? entryAmountLabel(first)
          : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
