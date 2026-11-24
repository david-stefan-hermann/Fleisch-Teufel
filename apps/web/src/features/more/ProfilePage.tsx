import {
  ACTIVITY_LABELS_DE,
  ageOn,
  DEFAULT_WEIGHT_RANGE,
  DEFAULT_WEIGHT_STEP,
  GOAL_KINDS,
  goalKindOf,
  weeklyRateForGoal,
  WEIGHT_RANGES,
  WEIGHT_STEPS,
  type ActivityLevel,
  type GoalKind,
  type Settings,
  type Sex,
} from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { textLinkClass } from '@/components/tappable';
import { useDb } from '@/app/session';
import { DiscardDialog } from '@/components/DiscardDialog';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { saveSettings } from '@/db/settings';
import { useCurrentWeight, useSettings, useToday } from '@/hooks/data';
import { useSettingsForm } from '@/hooks/useSettingsForm';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmtFixed } from '@/lib/format';

export function ProfilePage() {
  const settings = useSettings();
  const today = useToday();
  const weight = useCurrentWeight(today);
  if (!settings) return null;
  return <ProfileForm initial={settings} weightKg={weight ?? null} />;
}

const GOAL_OPTIONS: Record<GoalKind, string> = {
  lose: 'Abnehmen',
  maintain: 'Gewicht halten',
  gain_beginner: 'Muskeln aufbauen · unter 2 Jahre',
  gain_advanced: 'Muskeln aufbauen · ab 2 Jahren',
};

/** The fields this page owns; only these are saved (meal names or the plan changed elsewhere stay). */
const profileFields = (s: Settings) => ({
  sex: s.sex,
  birthDate: s.birthDate,
  heightCm: s.heightCm,
  activityLevel: s.activityLevel,
  targetWeightKg: s.targetWeightKg,
  weeklyRateKg: s.weeklyRateKg,
  goalKind: s.goalKind,
  weightStepKg: s.weightStepKg,
  weightRangeKg: s.weightRangeKg,
});

function ProfileForm({ initial, weightKg }: { initial: Settings; weightKg: number | null }) {
  const db = useDb();
  const [s, setS] = useState<Settings>(initial);
  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const today = useToday();
  const { run, busy } = useSubmitting();
  const age = s.birthDate ? ageOn(s.birthDate, today) : null;
  const dirty = JSON.stringify(profileFields(s)) !== JSON.stringify(profileFields(initial));
  const { blocker, close } = useSettingsForm(dirty, '/more');

  async function save() {
    await saveSettings(db, profileFields(s));
    toast.success('Profil gespeichert');
  }

  return (
    <Page
      title="Profil"
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
          <div className="grid gap-1.5">
            <Label htmlFor="p-goal">Ziel</Label>
            {/* Set up before the goals: shows the goal the stored rate means, saved only when changed. */}
            <Select
              value={s.goalKind ?? goalKindOf(s)}
              onValueChange={(v) => {
                const goalKind = v as GoalKind;
                set({
                  goalKind,
                  weeklyRateKg: weightKg !== null ? weeklyRateForGoal(goalKind, weightKg) : s.weeklyRateKg,
                });
              }}
            >
              <SelectTrigger id="p-goal" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GOAL_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {GOAL_OPTIONS[k]}
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
          </div>
        </div>
      </Section>
      <Section title="Gewichtseingabe">
        <div className="grid gap-4 p-4">
          <div className="grid grid-cols-2 items-start gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="p-weight-step">Raster</Label>
              <Select
                value={String(s.weightStepKg ?? DEFAULT_WEIGHT_STEP)}
                onValueChange={(v) => set({ weightStepKg: Number(v) as Settings['weightStepKg'] })}
              >
                <SelectTrigger id="p-weight-step" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEIGHT_STEPS.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      {fmtFixed(w, 2)} kg
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="p-weight-range">Sichtbarer Bereich</Label>
              <Select
                value={String(s.weightRangeKg ?? DEFAULT_WEIGHT_RANGE)}
                onValueChange={(v) => set({ weightRangeKg: Number(v) as Settings['weightRangeKg'] })}
              >
                <SelectTrigger id="p-weight-range" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEIGHT_RANGES.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      ±{fmtFixed(w, 1)} kg
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </Section>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        <Link to="/onboarding" className={textLinkClass({ inline: true })}>
          Ziele neu berechnen
        </Link>
      </p>
      <DiscardDialog
        open={blocker.status === 'blocked'}
        name="das Profil"
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
