import { DEFAULT_MEAL_NAMES, MEAL_COUNT, type Settings } from '@ft/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { useDb } from '@/app/session';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DiscardDialog } from '@/components/DiscardDialog';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ownMealNames, removeOwnMealName, saveStandardMealNames } from '@/db/diaryMeals';
import { useSettings } from '@/hooks/data';
import { useSettingsForm } from '@/hooks/useSettingsForm';
import { useSubmitting } from '@/hooks/useSubmitting';

/** The four standard names for meals to come, and the own names kept for the name picker. */
export function MealNamesPage() {
  const settings = useSettings();
  if (!settings) return null;
  return <MealNamesForm settings={settings} />;
}

function MealNamesForm({ settings }: { settings: Settings }) {
  const db = useDb();
  const [names, setNames] = useState<string[]>(() => [...settings.mealNames]);
  const { run, busy } = useSubmitting();
  const valid = names.every((n) => n.trim().length > 0 && n.trim().length <= 40);
  const trimmed = names.map((n) => n.trim());
  const dirty = JSON.stringify(trimmed) !== JSON.stringify(settings.mealNames);
  const { blocker, close } = useSettingsForm(dirty, '/more');
  const own = ownMealNames(settings);
  // The name stays while the dialog fades out.
  const [removal, setRemoval] = useState({ open: false, name: '' });

  async function save() {
    await saveStandardMealNames(db, trimmed);
    toast.success('Mahlzeiten umbenannt');
  }

  return (
    <Page
      title="Mahlzeiten-Namen"
      back="/more"
      withTabBar={false}
      footer={
        <Button
          size="lg"
          disabled={!valid || !dirty || busy}
          onClick={() =>
            void run(async () => {
              await save();
              close();
            })
          }
        >
          Speichern
        </Button>
      }
    >
      <Section title="Standard-Namen">
        <div className="grid gap-4 p-4 pt-2">
          {Array.from({ length: MEAL_COUNT }, (_, i) => (
            <div key={i} className="grid gap-1.5">
              <Label htmlFor={`meal-${i}`}>Mahlzeit {i + 1}</Label>
              <Input
                id={`meal-${i}`}
                autoComplete="off"
                maxLength={40}
                value={names[i]}
                placeholder={DEFAULT_MEAL_NAMES[i]}
                onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))}
              />
            </div>
          ))}
          <Button variant="outline" onClick={() => setNames([...DEFAULT_MEAL_NAMES])}>
            Standard
          </Button>
        </div>
      </Section>
      {own.length > 0 && (
        <Section title="Eigene Namen">
          <ul className="divide-y divide-border/70">
            {own.map((name) => (
              <li key={name} className="flex min-h-12 items-center gap-2 pr-2 pl-4">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`„${name}“ löschen`}
                  onClick={() => setRemoval({ open: true, name })}
                >
                  <Trash2 className="size-[18px] text-destructive" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <ConfirmDialog
        open={removal.open}
        onOpenChange={(open) => setRemoval((r) => ({ ...r, open }))}
        title={`„${removal.name}“ löschen?`}
        description="Eingetragene Mahlzeiten behalten diesen Namen."
        confirmLabel="Löschen"
        destructive
        onConfirm={() => removeOwnMealName(db, removal.name)}
      />
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name="die Mahlzeiten-Namen"
        onKeepEditing={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
        onSave={async () => {
          if (!valid) {
            toast.error('Jede Mahlzeit braucht einen Namen.');
            blocker.reset?.();
            return;
          }
          await save();
          blocker.proceed?.();
        }}
      />
    </Page>
  );
}
