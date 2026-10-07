import { DEFAULT_MEAL_NAMES, MEAL_COUNT, SETTINGS_ID, type Settings } from '@ft/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { saveRecord } from '@/db/write';
import { useSettings } from '@/hooks/data';

/** Rename the four meals (feature #1). */
export function MealNamesPage() {
  const settings = useSettings();
  if (!settings) return null;
  return <MealNamesForm settings={settings} />;
}

function MealNamesForm({ settings }: { settings: Settings }) {
  const db = useDb();
  const [names, setNames] = useState<string[]>(() => [...settings.mealNames]);
  const valid = names.every((n) => n.trim().length > 0 && n.trim().length <= 40);
  return (
    <Page title="Mahlzeiten" back="/more" withTabBar={false}>
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
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setNames([...DEFAULT_MEAL_NAMES])}>
              Standard
            </Button>
            <Button
              className="flex-1"
              disabled={!valid}
              onClick={async () => {
                await saveRecord(db, 'settings', {
                  ...settings,
                  id: SETTINGS_ID,
                  mealNames: names.map((n) => n.trim()),
                });
                toast.success('Mahlzeiten umbenannt');
              }}
            >
              Speichern
            </Button>
          </div>
        </div>
      </Section>
    </Page>
  );
}
