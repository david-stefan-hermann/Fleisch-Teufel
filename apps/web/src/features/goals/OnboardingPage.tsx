import {
  ACTIVITY_LABELS_DE,
  ageOn,
  calorieGoal,
  EXPENDITURE_WINDOW_DAYS,
  GOAL_KINDS,
  GOAL_LABELS_DE,
  GOALS,
  goalKindOf,
  macrosForPlan,
  kcalFromMacros,
  planFromPreset,
  today as todayOf,
  weeklyRateForGoal,
  weightOn,
  type ActivityLevel,
  type GoalKind,
  type MacroPlan,
  type Settings,
  type Sex,
} from '@ft/shared';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { choiceHoverClass } from '@/components/tappable';
import { useDb } from '@/app/session';
import { MacroPlanPicker } from '@/components/MacroPlanPicker';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { initialPlan } from './goalPlan';
import { saveOnboarding } from './saveOnboarding';
import { DEFAULT_SETTINGS, useSettings, useWeights } from '@/hooks/data';
import { useExpenditure } from '@/hooks/useExpenditure';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0, fmt1, fmt2, NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

const STEPS = ['Profil', 'Aktivität', 'Ziel', 'Ergebnis'] as const;

/** Onboarding/TDEE (feature #5): profile → activity → goal → computed targets (editable). */
export function OnboardingPage() {
  const settings = useSettings();
  const weights = useWeights();
  const expenditure = useExpenditure(todayOf());
  if (!settings || !weights || !expenditure) return null;
  return (
    <OnboardingForm
      settings={settings}
      weight={weightOn(weights, todayOf()) ?? null}
      expenditureKcal={expenditure.estimate?.kcal ?? null}
    />
  );
}

/** "−0,4" / "+0,08" / "±0" (U+2212 for the minus). */
function signed(n: number, fmt: (n: number) => string): string {
  return n === 0 ? '±0' : `${n < 0 ? '\u2212' : '+'}${fmt(Math.abs(n))}`;
}

function OnboardingForm({
  settings,
  weight: initialWeight,
  expenditureKcal,
}: {
  settings: Settings;
  weight: number | null;
  /** Expenditure from the person's own data (`useExpenditure`), null without an estimate. */
  expenditureKcal: number | null;
}) {
  const db = useDb();
  const navigate = useNavigate();
  const { run, busy } = useSubmitting();
  const today = todayOf();
  // Prefilled from an existing profile when the calculator is run again.
  const known = settings.updatedAt > 0;
  const [step, setStep] = useState(0);
  const [sex, setSex] = useState<Sex | null>(settings.sex);
  const [birthDate, setBirthDate] = useState(settings.birthDate ?? '');
  const [height, setHeight] = useState<number | null>(settings.heightCm);
  const [weight, setWeight] = useState<number | null>(initialWeight);
  const [activity, setActivity] = useState<ActivityLevel>(known ? settings.activityLevel : 'light');
  const [targetWeight, setTargetWeight] = useState<number | null>(settings.targetWeightKg);
  const [goalKind, setGoalKind] = useState<GoalKind>(known ? goalKindOf(settings) : 'lose');
  const [kcal, setKcal] = useState<number | null>(null);
  const [protein, setProtein] = useState<number | null>(null);
  const [fat, setFat] = useState<number | null>(null);
  const [carbs, setCarbs] = useState<number | null>(null);
  const [plan, setPlanState] = useState<MacroPlan>(() => initialPlan(settings, goalKind, known));

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
  const profile = profileValid ? { sex: sex!, ageYears: age!, heightCm: height!, weightKg: weight! } : null;
  const rateOf = (kind: GoalKind) => (weight !== null ? weeklyRateForGoal(kind, weight) : 0);
  const goalFor = (kind: GoalKind) =>
    profile ? calorieGoal(profile, activity, rateOf(kind), { expenditureKcal }) : null;
  const rate = rateOf(goalKind);
  const goal = goalFor(goalKind);
  const formulaTdee = profile && expenditureKcal !== null ? calorieGoal(profile, activity, 0).tdee : null;

  function chooseGoal(kind: GoalKind) {
    setGoalKind(kind);
    setPlanState(planFromPreset(GOALS[kind].preset));
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
        goalKind,
        macroPlan: plan,
      },
      weightKg: weight!,
      target: { kcal, proteinG: protein, fatG: fat, carbsG: carbs },
      today,
    });
    toast.success('Ziele gespeichert');
    // Never back into the finished form.
    await navigate({ to: '/', replace: true });
  }

  const next = () => {
    if (step === 2) computeTargets();
    setStep(step + 1);
  };
  const canNext = step === 0 ? profileValid : true;
  // Weeks to the target only when the goal points towards it (losing with a target above = never).
  const toGo = targetWeight !== null && weight !== null ? targetWeight - weight : null;
  const weeks = toGo !== null && rate !== 0 && Math.sign(toGo) === Math.sign(rate) ? toGo / rate : null;
  const profileHint =
    age !== null && (age < 14 || age > 110)
      ? 'Der Rechner gilt für 14 bis 110 Jahre.'
      : height !== null && (height < 120 || height > 230)
        ? 'Größe zwischen 120 und 230 cm.'
        : weight !== null && (weight < 30 || weight > 300)
          ? 'Gewicht zwischen 30 und 300 kg.'
          : null;

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
                  activity === a ? 'border-primary bg-primary/5' : choiceHoverClass,
                )}
              >
                <div className="font-medium">{ACTIVITY_LABELS_DE[a].title}</div>
                <div className="text-sm text-muted-foreground">{ACTIVITY_LABELS_DE[a].hint}</div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {step === 2 && (
        <>
          <Section>
            <div className="grid gap-2 p-4" role="radiogroup" aria-label="Ziel">
              {GOAL_KINDS.map((k) => {
                const g = goalFor(k);
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={goalKind === k}
                    onClick={() => chooseGoal(k)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                      goalKind === k ? 'border-primary bg-primary/5' : choiceHoverClass,
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{GOAL_LABELS_DE[k].title}</div>
                      {GOAL_LABELS_DE[k].hint && (
                        <div className="text-sm text-muted-foreground">{GOAL_LABELS_DE[k].hint}</div>
                      )}
                    </div>
                    <div className="tabular shrink-0 text-right text-sm text-muted-foreground">
                      {k === 'maintain' ? (
                        '±0'
                      ) : (
                        <>
                          <div>{signed(rateOf(k), fmt2)} kg pro Woche</div>
                          {g && <div>{signed(g.kcal - g.tdee, fmt0)} kcal</div>}
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Section>
          <Section>
            <div className="grid gap-2 p-4">
              <NumberField
                label="Zielgewicht (optional)"
                unit="kg"
                value={targetWeight}
                onValueChange={setTargetWeight}
              />
              {toGo !== null && Math.abs(toGo) >= 0.1 && (
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Dauer</span>
                  <span className="tabular">
                    {weeks !== null && weeks < 300
                      ? `frühestens in ${fmt0(Math.max(1, Math.ceil(weeks)))} Wochen`
                      : NO_VALUE}
                  </span>
                </div>
              )}
            </div>
          </Section>
        </>
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
                {goal.source === 'data' && (
                  <dd>
                    <Badge variant="secondary">aus deinen Daten</Badge>
                  </dd>
                )}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Ziel</dt>
                <dd className="text-lg font-bold text-primary">{fmt0(goal.kcal)}</dd>
                {goal.clamped && (
                  <dd>
                    <Badge variant="outline" className="text-warn-text">
                      {goal.clamped === 'deficit' ? 'Defizit begrenzt' : 'Untergrenze'}
                    </Badge>
                  </dd>
                )}
              </div>
            </dl>
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              {formulaTdee !== null
                ? `Aus Essen und Gewichtstrend der letzten ${EXPENDITURE_WINDOW_DAYS} Tage · Formel ${fmt0(formulaTdee)} kcal`
                : 'Mifflin-St Jeor × Aktivitätsfaktor, plus/minus 7700 kcal je kg Wochenziel.'}
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
                  <p className="text-xs text-warn-text">
                    Die Makros ergeben {fmt0(kcalFromMacros({ proteinG: protein, fatG: fat, carbsG: carbs }))}{' '}
                    kcal. Passe sie an dein Kalorienziel an.
                  </p>
                )}
              <p className="text-xs text-muted-foreground">
                Das sind {fmt1(protein && weight ? protein / weight : 0)} g Eiweiß pro kg Körpergewicht.
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
          <div className="grid flex-1 gap-1">
            <Button size="lg" disabled={!canNext} onClick={next}>
              Weiter
            </Button>
            {step === 0 && profileHint && <p className="text-center text-xs text-warn-text">{profileHint}</p>}
          </div>
        ) : (
          <Button size="lg" className="flex-1" disabled={busy} onClick={() => void run(finish)}>
            Ziele speichern
          </Button>
        )}
      </div>
    </Page>
  );
}
