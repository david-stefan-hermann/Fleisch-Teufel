import { DAY_START_HOURS, dayStartOf, type Settings } from '@ft/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { DiscardDialog } from '@/components/DiscardDialog';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { saveSettings } from '@/db/settings';
import { useSettings } from '@/hooks/data';
import { useSettingsForm } from '@/hooks/useSettingsForm';
import { useSubmitting } from '@/hooks/useSubmitting';

/** "3 Uhr": the hour the app's day begins at. */
export const dayStartLabel = (hour: number) => `${hour} Uhr`;

/** The hour the app's day begins at, for the whole account (`settings.dayStartHour`). */
export function DayStartPage() {
  const settings = useSettings();
  if (!settings) return null;
  return <DayStartForm settings={settings} />;
}

function DayStartForm({ settings }: { settings: Settings }) {
  const db = useDb();
  const saved = dayStartOf(settings.dayStartHour);
  const [hour, setHour] = useState(saved);
  const { run, busy } = useSubmitting();
  const dirty = hour !== saved;
  const { blocker, close } = useSettingsForm(dirty, '/more');
  // A value set elsewhere that the list does not offer stays choosable.
  const hours = (DAY_START_HOURS as readonly number[]).includes(saved)
    ? DAY_START_HOURS
    : [...DAY_START_HOURS, saved];

  async function save() {
    await saveSettings(db, { dayStartHour: hour });
    toast.success(`Der Tag beginnt um ${dayStartLabel(hour)}`);
  }

  return (
    <Page
      title="Tagesbeginn"
      back="/more"
      withTabBar={false}
      footer={
        <Button
          size="lg"
          disabled={!dirty || busy}
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
        <div className="grid gap-1.5 p-4">
          <Label htmlFor="day-start">Der Tag beginnt um</Label>
          <Select value={String(hour)} onValueChange={(v) => setHour(Number(v))}>
            <SelectTrigger id="day-start" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {hours.map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {dayStartLabel(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name="den Tagesbeginn"
        onKeepEditing={() => blocker.reset?.()}
        onDiscard={() => blocker.proceed?.()}
        onSave={async () => {
          await save();
          blocker.proceed?.();
        }}
      />
    </Page>
  );
}
