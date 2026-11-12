import { DEFAULT_MEAL_NAMES, MEAL_COUNT, type Settings } from '@ft/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DiscardDialog } from '@/components/DiscardDialog';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveSettings } from '@/db/settings';
import { useSettings } from '@/hooks/data';
import { useSettingsForm } from '@/hooks/useSettingsForm';
import { useSubmitting } from '@/hooks/useSubmitting';

/** Rename the four meals (feature #1). */
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

  async function save() {
    await saveSettings(db, { mealNames: trimmed });
    toast.success('Mahlzeiten umbenannt');
  }

  return (
    <Page
      title="Mahlzeiten"
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
      <Section>
        <div className="grid gap-4 p-4">
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
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name="die Mahlzeiten"
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
