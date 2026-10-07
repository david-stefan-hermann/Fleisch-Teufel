import {
  ACTIVITY_LABELS_DE,
  ageOn,
  SETTINGS_ID,
  today,
  WEEKLY_RATES,
  type ActivityLevel,
  type Settings,
  type Sex,
} from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { saveRecord } from '@/db/write';
import { useSettings } from '@/hooks/data';

export function ProfilePage() {
  const settings = useSettings();
  if (!settings) return null;
  return <ProfileForm initial={settings} />;
}

function ProfileForm({ initial }: { initial: Settings }) {
  const db = useDb();
  const [s, setS] = useState<Settings>(initial);
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const age = s.birthDate ? ageOn(s.birthDate, today()) : null;

  return (
    <Page title="Profil" back="/more" withTabBar={false}>
      <Section>
        <div className="grid gap-4 p-4">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Geschlecht</span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={s.sex ?? ''}
              onValueChange={(v) => v && set({ sex: v as Sex })}
              className="w-full"
            >
              <ToggleGroupItem value="male" className="flex-1">
                Männlich
              </ToggleGroupItem>
              <ToggleGroupItem value="female" className="flex-1">
                Weiblich
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-2 items-start gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-birth">Geburtsdatum</Label>
              <Input
                id="p-birth"
                type="date"
                autoComplete="bday"
                value={s.birthDate ?? ''}
                onChange={(e) => set({ birthDate: e.target.value || null })}
              />
              {age !== null && <p className="text-xs text-muted-foreground">{age} Jahre</p>}
            </div>
            <NumberField
              label="Größe"
              unit="cm"
              value={s.heightCm}
              onValueChange={(v) => set({ heightCm: v })}
              integer
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p-activity">Aktivität im Alltag</Label>
            <Select value={s.activityLevel} onValueChange={(v) => set({ activityLevel: v as ActivityLevel })}>
              <SelectTrigger id="p-activity" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ACTIVITY_LABELS_DE) as ActivityLevel[]).map((a) => (
                  <SelectItem key={a} value={a}>
                    {ACTIVITY_LABELS_DE[a].title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 items-start gap-3">
            <NumberField
              label="Zielgewicht"
              unit="kg"
              value={s.targetWeightKg}
              onValueChange={(v) => set({ targetWeightKg: v })}
            />
            <div className="grid gap-1.5">
              <Label htmlFor="p-rate">Tempo/Woche</Label>
              <Select value={String(s.weeklyRateKg)} onValueChange={(v) => set({ weeklyRateKg: Number(v) })}>
                <SelectTrigger id="p-rate" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKLY_RATES.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      {r > 0 ? '+' : ''}
                      {r.toLocaleString('de-DE')} kg
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Section>
      <Button
        size="lg"
        className="w-full"
        onClick={async () => {
          await saveRecord(db, 'settings', { ...s, id: SETTINGS_ID });
          toast.success('Profil gespeichert');
        }}
      >
        Speichern
      </Button>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        Profiländerungen passen deine Ziele nicht automatisch an.{' '}
        <Link to="/onboarding" className="text-primary underline">
          Ziele neu berechnen
        </Link>
      </p>
    </Page>
  );
}
