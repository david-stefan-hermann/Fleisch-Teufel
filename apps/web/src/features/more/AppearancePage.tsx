import { overLevel, parseISODate, WEEKDAYS_SHORT_DE, weekdayIndex, type StripMark } from '@ft/shared';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSessionContext } from '@/app/session';
import { Page, Section } from '@/components/Page';
import { AssistantAppearance } from '@/features/assistant/skins/SkinPicker';
import { UploadedSkins } from '@/features/assistant/skins/UploadedSkins';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MacroSummary } from '@/features/diary/MacroSummary';
import { StripDay, stripDayClass } from '@/features/diary/StripDay';
import { stripDays } from '@/features/diary/stripDays';
import { useToday } from '@/hooks/data';
import {
  ICON_FILES,
  setDiaryMacrosPref,
  setIconPref,
  setThemePref,
  setWeekMarksPref,
  setWeekStripPref,
  useAppearance,
  WEEK_MARKS,
  type DiaryMacrosPref,
  type IconPref,
  type ThemePref,
  type WeekMarksPref,
  type WeekStripPref,
} from '@/lib/appearance';
import { cn } from '@/lib/utils';

const THEMES: { value: ThemePref; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor aria-hidden /> },
  { value: 'light', label: 'Hell', icon: <Sun aria-hidden /> },
  { value: 'dark', label: 'Dunkel', icon: <Moon aria-hidden /> },
];

const DIARY_MACROS: { value: DiaryMacrosPref; label: string }[] = [
  { value: 'numbers', label: 'Zahlen' },
  { value: 'bar', label: 'Mit Balken' },
];
const WEEK_STRIP: { value: WeekStripPref; label: string }[] = [
  { value: 'week', label: 'Kalenderwoche' },
  { value: 'recent', label: 'Letzte Tage' },
];
/** Fixed row of the preview (a portion of chicken fricassee). */
const PREVIEW = { ENERCC: 695, PROT625: 52, CHO: 38, FAT: 36 };

/**
 * The example week of the week strip looks (mockup v3): within the budget with training, just over,
 * within, over, far over with training, today with training and selected, an empty day.
 */
const EXAMPLE_WEEK: { weekday: string; day: number; eaten?: number; budget: number; training?: number }[] = [
  { weekday: 'Mo', day: 16, eaten: 1900, budget: 2420, training: 320 },
  { weekday: 'Di', day: 17, eaten: 2190, budget: 2100 },
  { weekday: 'Mi', day: 18, eaten: 2060, budget: 2100 },
  { weekday: 'Do', day: 19, eaten: 2440, budget: 2100 },
  { weekday: 'Fr', day: 20, eaten: 3150, budget: 2390, training: 290 },
  { weekday: 'Sa', day: 21, eaten: 1150, budget: 2400, training: 300 },
  { weekday: 'So', day: 22, budget: 2100 },
];
const EXAMPLE_TODAY = 5;
const EXAMPLE_MARKS: (StripMark | undefined)[] = EXAMPLE_WEEK.map((d) => {
  const over = d.eaten != null && d.eaten > d.budget;
  return {
    food: d.eaten != null,
    training: !!d.training,
    verdict: d.eaten == null ? null : over ? 'over' : 'ok',
    level: over ? overLevel(d.eaten!, d.budget) : null,
    eatenKcal: d.eaten ?? 0,
    budgetKcal: d.budget,
    trainingKcal: d.training ?? 0,
  };
});

/** The example week in one look (not operable). */
function ExampleWeek({ variant }: { variant: WeekMarksPref }) {
  return (
    <span aria-hidden className="grid grid-cols-7 gap-1">
      {EXAMPLE_WEEK.map((d, i) => {
        const selected = i === EXAMPLE_TODAY;
        const mark = EXAMPLE_MARKS[i];
        return (
          <span key={d.day} className={stripDayClass({ mark, selected, today: selected, variant })}>
            <StripDay weekday={d.weekday} day={d.day} mark={mark} selected={selected} variant={variant} />
          </span>
        );
      })}
    </span>
  );
}

/** Mehr → Aussehen: app theme, diary macros and logo variant of this device. */
export function AppearancePage() {
  const a = useAppearance();
  const today = useToday();
  const { serverInfo } = useSessionContext();
  const icons: { value: IconPref; label: string; files: string[] }[] = [
    { value: 'auto', label: 'Wie die App', files: [ICON_FILES.light.logo, ICON_FILES.dark.logo] },
    { value: 'light', label: 'Hell', files: [ICON_FILES.light.logo] },
    { value: 'dark', label: 'Dunkel', files: [ICON_FILES.dark.logo] },
  ];
  return (
    <Page title="Aussehen" back="/more" withTabBar={false}>
      <Section title="Darstellung">
        <div className="grid gap-2 px-4 pb-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={a.theme}
            onValueChange={(v) => v && setThemePref(v as ThemePref)}
            className="w-full"
            aria-label="Darstellung der App"
          >
            {THEMES.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value} className="h-12 flex-1 gap-2">
                {t.icon}
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </Section>

      <Section title="Tagebuch">
        <div className="grid gap-3 px-4 pb-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={a.diaryMacros}
            onValueChange={(v) => v && setDiaryMacrosPref(v as DiaryMacrosPref)}
            className="w-full"
            aria-label="Makros in den Tagebuchzeilen"
          >
            {DIARY_MACROS.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value} className="h-12 flex-1">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex min-h-13 items-center gap-3 rounded-xl bg-muted px-4 py-2" aria-hidden>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">Hühner Frikassee</div>
              <div className="truncate text-xs text-muted-foreground">500 g</div>
            </div>
            <MacroSummary nutrients={PREVIEW} variant={a.diaryMacros} />
          </div>
          <ToggleGroup
            type="single"
            variant="outline"
            value={a.weekStrip}
            onValueChange={(v) => v && setWeekStripPref(v as WeekStripPref)}
            className="mt-1 w-full"
            aria-label="Tage in der Wochenleiste"
          >
            {WEEK_STRIP.map((m) => (
              <ToggleGroupItem key={m.value} value={m.value} className="h-12 flex-1">
                {m.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ol className="grid grid-cols-7 gap-1 rounded-xl bg-muted p-1" aria-hidden>
            {stripDays(today, today, a.weekStrip).map((d) => (
              <li
                key={d}
                className={cn(
                  'flex h-12 flex-col items-center justify-center rounded-lg text-xs',
                  d === today && 'font-semibold text-primary',
                )}
              >
                <span className="opacity-80">{WEEKDAYS_SHORT_DE[weekdayIndex(d)]}</span>
                <span className="tabular text-base font-semibold">{parseISODate(d).getDate()}</span>
              </li>
            ))}
          </ol>
          <RadioGroup
            value={a.weekMarks}
            onValueChange={(v) => setWeekMarksPref(v as WeekMarksPref)}
            aria-label="Zeichen in der Wochenleiste"
            className="mt-1 gap-2"
          >
            {WEEK_MARKS.map((m) => (
              <Label
                key={m.value}
                className="grid cursor-pointer gap-2 rounded-xl border border-border p-3 font-normal has-data-[state=checked]:border-primary has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary"
              >
                <span className="flex items-center gap-3">
                  <RadioGroupItem value={m.value} />
                  {m.label}
                </span>
                <ExampleWeek variant={m.value} />
              </Label>
            ))}
          </RadioGroup>
        </div>
      </Section>

      {serverInfo?.assistantEnabled && <AssistantAppearance uploads={<UploadedSkins />} />}

      <Section title="App-Icon">
        <div className="grid gap-3 px-4 pb-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={a.icon}
            onValueChange={(v) => v && setIconPref(v as IconPref)}
            className="w-full"
            aria-label="App-Icon"
          >
            {icons.map((i) => (
              <ToggleGroupItem key={i.value} value={i.value} className="h-auto flex-1 flex-col gap-2 py-3">
                <span className="flex h-12 items-center" aria-hidden>
                  {i.files.map((f, n) => (
                    <img
                      key={f}
                      src={f}
                      width={44}
                      height={44}
                      alt=""
                      className={n > 0 ? '-ml-4 drop-shadow-md' : 'drop-shadow-sm'}
                    />
                  ))}
                </span>
                <span className="text-sm">{i.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="grid gap-1.5 rounded-xl bg-muted p-3 text-xs text-pretty">
            <p className="font-medium text-foreground">Icon auf dem Home-Bildschirm</p>
            <p className="text-muted-foreground">
              iOS übernimmt das Icon einmal beim Hinzufügen zum Home-Bildschirm und tauscht es danach nicht
              mehr. Für ein anderes Icon: diese Einstellung wählen, die App vom Home-Bildschirm entfernen und
              in Safari über Teilen → „Zum Home-Bildschirm“ neu hinzufügen.
            </p>
            <p className="text-muted-foreground">
              Beim Entfernen löscht iOS die Daten auf dem Gerät; nach dem Anmelden kommen sie vom Server
              zurück. Prüfe vorher unter „Daten &amp; Synchronisation“, dass alles synchronisiert ist.
            </p>
          </div>
        </div>
      </Section>
    </Page>
  );
}
