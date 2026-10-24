import { ClipboardList, ClipboardX, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NameDialog } from '@/components/NameDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { clearClipboard, clipboardKcal, type Clipboard, CLIPBOARD_KEY } from '@/db/clipboard';
import { saveMealFromItems } from '@/db/entries';
import { fmt0, fmtIngredients } from '@/lib/format';
import { entryAmountLabel } from './MealCard';

/**
 * The clipboard icon in the diary header (only while something is copied): what is copied, "Als Meal
 * speichern" for a copied group (e.g. a scanned meal) and "Zwischenablage leeren".
 */
export function ClipboardMenu({ clipboard }: { clipboard: Clipboard }) {
  const db = useDb();
  const [saveOpen, setSaveOpen] = useState(false);
  const isGroup = clipboard.kind === 'group';
  const first = clipboard.items[0];
  const detail = [
    `${fmt0(clipboardKcal(clipboard))} kcal`,
    isGroup ? fmtIngredients(clipboard.items.length) : first ? entryAmountLabel(first) : '',
  ]
    .filter(Boolean)
    .join(' · ');
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
          {isGroup && (
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
      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Als Meal speichern"
        description={`${fmtIngredients(clipboard.items.length)} ${clipboard.items.length === 1 ? 'wird' : 'werden'} als wiederverwendbares Meal gespeichert.`}
        confirmLabel="Meal speichern"
        defaultName={clipboard.name}
        placeholder="z. B. Mein Mittagessen…"
        onConfirm={async (name) => {
          await saveMealFromItems(db, name, clipboard.items, clipboard.photoIds[0] ?? null);
          toast.success(`„${name}“ gespeichert`);
        }}
      />
    </>
  );
}
