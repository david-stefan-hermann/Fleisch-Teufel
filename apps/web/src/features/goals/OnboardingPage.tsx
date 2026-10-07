import {
  ACTIVITY_LABELS_DE,
  ageOn,
  calorieGoal,
  DEFAULT_MACRO_PLAN,
  macrosForPlan,
  kcalFromMacros,
  today as todayOf,
  WEEKLY_RATES,
  weightOn,
  type ActivityLevel,
  type MacroPlan,
  type Settings,
  type Sex,
} from '@ft/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MacroPlanPicker } from '@/components/MacroPlanPicker';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { saveOnboarding } from './saveOnboarding';
import { DEFAULT_SETTINGS, useSettings, useWeights } from '@/hooks/data';
import { fmt0, fmt1 } from '@/lib/format';
import { cn } from '@/lib/utils';

const STEPS = ['Profil', 'Aktivität', 'Ziel', 'Ergebnis'] as const;

/** Onboarding/TDEE (feature #5): profile → activity → goal → computed targets (editable). */
export function OnboardingPage() {
  const settings = useSettings();
  const weights = useWeights();
  if (!settings || !weights) return null;
  return <OnboardingForm settings={settings} weight={weightOn(weights, todayOf()) ?? null} />;
}

function OnboardingForm({ settings, weight: initialWeight }: { settings: Settings; weight: number | null }) {
  const db = useDb();
  const navigate = useNavigate();
  const today = todayOf();
  // Prefilled from an existing profile when the calculator is run again.
  const known = settings.updatedAt > 0;
  const [step, setStep] = useState(0);
  const [sex, setSex] = useState<Sex | null>(settings.sex);
  const [birthDate, setBirthDate] = useState(settings.birthDate ?? '');
  const [height, setHeight] = useState<number | null>(settings.heightCm);
  const [weight, setWeight] = useState<number | null>(initialWeight);
  const [activity, setActivity] = useState<ActivityLevel>(known ? settings.activityLevel : 'light');
  const [targetWeight, setTargetWeightRaw] = useState<number | null>(settings.targetWeightKg);
  const [rate, setRate] = useState(known ? settings.weeklyRateKg : -0.5);
  const [kcal, setKcal] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [plan, setPlanState] = useState<MacroPlan>(settings.macroPlan ?? DEFAULT_MACRO_PLAN);

  const age = birthDate ? ageOn(birthDate, today) : null;
  const profileValid =
    sex !== null &&
    age !== null &&
    age >= 14 &&
    age <= 110 &&
    height !== null &&
    height >= 120 &&
    height <= 230 &&
    weight !== null &&
    weight >= 30 &&
    weight <= 300;
  const goal = profileValid
    ? calorieGoal({ sex: sex!, ageYears: age!, heightCm: height!, weightKg: weight! }, activity, rate)
    : null;

  // Entering a target weight suggests the matching direction.
  function setTargetWeight(t: number | null) {
    setTargetWeightRaw(t);
    if (t === null || weight === null) return;
    if (Math.abs(t - weight) < 0.5) setRate(0);
    else if (t > weight && rate <= 0) setRate(0.25);
    else if (t < weight && rate >= 0) setRate(-0.5);
  }

  function applyMacros(kcalTarget: number, p: MacroPlan) {
    if (weight === null) return;
    const m = macrosForPlan(kcalTarget, weight, p);
    setKcal(m.kcal);
    setProtein(m.proteinG);
    setFat(m.fatG);
    setCarbs(m.carbsG);
  }

  function computeTargets() {
    if (goal) applyMacros(goal.kcal, plan);
  }

  function setPlan(p: MacroPlan) {
    setPlanState(p);
    if (kcal !== null) applyMacros(kcal, p);
  }

  async function finish() {
    if (!profileValid || kcal === null || protein === null || fat === null || carbs === null) return;
    await saveOnboarding(db, {
      base: known ? settings : DEFAULT_SETTINGS,
      profile: {
        sex,
        birthDate,
        heightCm: height,
        activityLevel: activity,
        targetWeightKg: targetWeight,
        weeklyRateKg: rate,
        macroPlan: plan,
      },
      weightKg: weight!,
      target: { kcal, proteinG: protein, fatG: fat, carbsG: carbs },
      today,
    });
    toast.success('Ziele gespeichert');
    await navigate({ to: '/' });
  }

  const next = () => {
    if (step === 2) computeTargets();
    setStep(step + 1);
  };
  const canNext = step === 0 ? profileValid : true;
  const weeks =
    targetWeight !== null && weight !== null && rate !== 0 ? Math.abs((targetWeight - weight) / rate) : null;

  return (
    <Page title="Ziele einrichten" back withTabBar={false}>
      <ol className="mb-4 grid grid-cols-4 gap-2" aria-label="Fortschritt">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className="grid gap-1 text-center text-xs"
          >
            <span className={cn('h-1.5 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
            <span className={i === step ? 'font-semibold' : 'text-muted-foreground'}>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Section>
          <div className="grid gap-4 p-4">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Geschlecht (für die Grundumsatz-Formel)</span>
              <ToggleGroup
                type="single"
                variant="outline"
                value={sex ?? ''}
                onValueChange={(v) => v && setSex(v as Sex)}
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
            <div className="grid gap-1.5">
              <Label htmlFor="birth">Geburtsdatum</Label>
              <Input
                id="birth"
                type="date"
                autoComplete="bday"
                value={birthDate}
                max={today}
                onChange={(e) => setBirthDate(e.target.value)}
              />
              {age !== null && <p className="text-xs text-muted-foreground">{age} Jahre</p>}
            </div>
            <div className="grid grid-cols-2 items-start gap-3">
              <NumberField label="Größe" unit="cm" value={height} onValueChange={setHeight} integer />
              <NumberField label="Aktuelles Gewicht" unit="kg" value={weight} onValueChange={setWeight} />
            </div>
          </div>
        </Section>
      )}

      {step === 1 && (
        <Section title="Wie aktiv ist dein Alltag, ohne Sport?">
          <div className="grid gap-2 px-4 pb-4" role="radiogroup" aria-label="Aktivität">
            {(Object.keys(ACTIVITY_LABELS_DE) as ActivityLevel[]).map((a) => (
              <button
                key={a}
                type="button"
                role="radio"
                aria-checked={activity === a}
                onClick={() => setActivity(a)}
                className={cn(
                  'rounded-xl border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  activity === a ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                )}
              >
                <div className="font-medium">{ACTIVITY_LABELS_DE[a].title}</div>
                <div className="text-sm text-muted-foreground">{ACTIVITY_LABELS_DE[a].hint}</div>
              </button>
            ))}
            <p className="mt-1 text-xs text-muted-foreground">
              Training trägst du separat ein, es wird dann zusätzlich angerechnet.
            </p>
          </div>
        </Section>
      )}

      {step === 2 && (
        <Section>
          <div className="grid gap-4 p-4">
            <NumberField
              label="Zielgewicht (optional)"
              unit="kg"
              value={targetWeight}
              onValueChange={setTargetWeight}
            />
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Tempo pro Woche</span>
              <div className="grid grid-cols-4 gap-2">
                {WEEKLY_RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={rate === r}
                    onClick={() => setRate(r)}
                    className={cn(
                      'tabular h-12 rounded-lg border text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                      rate === r ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent',
                    )}
                  >
                    {r > 0 ? '+' : ''}
                    {r.toLocaleString('de-DE')} kg
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {rate === 0
                  ? 'Gewicht halten.'
                  : `${rate < 0 ? 'Abnehmen' : 'Zunehmen'}: ${fmt0(Math.abs(rate * 7700) / 7)} kcal ${rate < 0 ? 'weniger' : 'mehr'} pro Tag.`}
                {weeks !== null && weeks < 300 && ` Ziel in etwa ${fmt0(weeks)} Wochen.`}
                {rate <= -1 && ' Mehr als 1 % des Körpergewichts pro Woche ist für die meisten zu schnell.'}
              </p>
            </div>
          </div>
        </Section>
      )}

      {step === 3 && goal && (
        <>
          <Section>
            <dl className="tabular grid grid-cols-3 gap-2 p-4 text-center">
              <div>
                <dt className="text-xs text-muted-foreground">Grundumsatz</dt>
                <dd className="text-lg font-semibold">{fmt0(goal.bmr)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Gesamtumsatz</dt>
                <dd className="text-lg font-semibold">{fmt0(goal.tdee)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Ziel</dt>
                <dd className="text-lg font-bold text-primary">{fmt0(goal.kcal)}</dd>
              </div>
            </dl>
            {goal.clamped && (
              <p className="px-4 pb-4 text-xs text-warn">
                Das rechnerische Ziel lag unter {fmt0(goal.kcal)} kcal und wurde angehoben. Wähle ein
                langsameres Tempo für ein nachhaltiges Defizit.
              </p>
            )}
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              Mifflin-St Jeor × Aktivitätsfaktor, plus/minus 7700 kcal je kg Wochenziel.
            </p>
          </Section>
          <Section title="Makro-Verteilung">
            <div className="px-4 pb-4">
              <MacroPlanPicker plan={plan} onChange={setPlan} kcal={kcal ?? goal.kcal} weightKg={weight} />
            </div>
          </Section>
          <Section title="Tagesziele (anpassbar)">
            <div className="grid gap-3 px-4 pb-4">
              <NumberField label="Kalorien" unit="kcal" value={kcal} onValueChange={setKcal} integer />
              <div className="grid grid-cols-3 gap-3">
                <NumberField label="Protein" unit="g" value={protein} onValueChange={setProtein} integer />
                <NumberField label="Kohlenh." unit="g" value={carbs} onValueChange={setCarbs} integer />
                <NumberField label="Fett" unit="g" value={fat} onValueChange={setFat} integer />
              </div>
              {kcal !== null &&
                protein !== null &&
                fat !== null &&
                carbs !== null &&
                Math.abs(kcalFromMacros({ proteinG: protein, fatG: fat, carbsG: carbs }) - kcal) > 50 && (
                  <p className="text-xs text-warn">
                    Die Makros ergeben {fmt0(kcalFromMacros({ proteinG: protein, fatG: fat, carbsG: carbs }))}{' '}
                    kcal. Passe sie an dein Kalorienziel an.
                  </p>
                )}
              <p className="text-xs text-muted-foreground">
                Das sind {fmt1(protein && weight ? protein / weight : 0)} g Eiweiß pro kg Körpergewicht. Ziele
                je Wochentag stellst du danach unter „Ziele“ ein.
              </p>
            </div>
          </Section>
        </>
      )}

      <div className="mt-2 flex gap-3">
        {step > 0 && (
          <Button variant="outline" size="lg" onClick={() => setStep(step - 1)}>
            Zurück
          </Button>
        )}
        {step < 3 ? (
          <Button size="lg" className="flex-1" disabled={!canNext} onClick={next}>
            Weiter
          </Button>
        ) : (
          <Button size="lg" className="flex-1" onClick={() => void finish()}>
            Ziele speichern
          </Button>
        )}
      </div>
    </Page>
  );
}
