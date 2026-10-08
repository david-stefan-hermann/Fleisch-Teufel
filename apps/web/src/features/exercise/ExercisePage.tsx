import {
  DEFAULT_WEIGHT_KG,
  EXERCISE_TYPE_MAP,
  EXERCISE_TYPES,
  INTENSITY_LABELS_DE,
  metFor,
  netExerciseKcal,
  normalize,
  recentTrainings,
  round,
  uuidv7,
  type ExerciseEntry,
  type ExerciseTemplate,
  type Intensity,
} from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookmarkPlus, Check, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { NumberField } from '@/components/NumberField';
import { Page, Section } from '@/components/Page';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { saveExercise, saveExerciseTemplate } from '@/db/entries';
import { deleteRecord, restoreRecord, saveRecord } from '@/db/write';
import { useCurrentWeight, useSettings } from '@/hooks/data';
import { fmt0, fmt1, fmtDate, fmtDayLong, NO_VALUE } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TypeOption {
  key: string;
  name: string;
  met: { light?: number; moderate: number; vigorous?: number };
  custom: boolean;
}

/** Simple training log (feature #9): type, duration, intensity → MET-based kcal. */
export function ExercisePage() {
  const { date, entryId } = useSearch({ from: '/authed/exercise' });
  const db = useDb();
  const entry = useLiveQuery(
    async () => (entryId ? ((await db.exerciseEntries.get(entryId)) ?? null) : null),
    [db, entryId],
  );
  if (entry === undefined) return null;
  return <ExerciseForm key={entry?.id ?? 'new'} date={date} entry={entry} />;
}

function ExerciseForm({ date, entry }: { date: string; entry: ExerciseEntry | null }) {
  const db = useDb();
  const navigate = useNavigate();
  const settings = useSettings();
  const weight = useCurrentWeight(date);
  const customTypes = useLiveQuery(() => db.exerciseTypes.filter((t) => !t.deleted).toArray(), [db]);
  const templates = useLiveQuery(() => db.exerciseTemplates.filter((t) => !t.deleted).sortBy('name'), [db]);
  const recent = useLiveQuery(
    async () =>
      recentTrainings(
        await db.exerciseEntries
          .orderBy('date')
          .reverse()
          .filter((e) => !e.deleted)
          .limit(100)
          .toArray(),
      ),
    [db],
  );

  const options: TypeOption[] = useMemo(
    () => [
      ...(customTypes ?? []).map((t) => ({
        key: t.id,
        name: t.name,
        met: { moderate: t.met },
        custom: true,
      })),
      ...EXERCISE_TYPES.map((t) => ({ key: t.key, name: t.name, met: t.met, custom: false })),
    ],
    [customTypes],
  );
  const [typeKey, setTypeKey] = useState<string | null>(entry?.typeKey ?? null);
  const [intensity, setIntensity] = useState<Intensity>(entry?.intensity ?? 'moderate');
  const [minutes, setMinutes] = useState<number | null>(entry?.minutes ?? 30);
  const [note, setNote] = useState(entry?.note ?? '');
  const [filter, setFilter] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const type = options.find((o) => o.key === typeKey) ?? null;
  const usedWeight = entry?.weightKg ?? weight ?? DEFAULT_WEIGHT_KG;
  const met = type ? metFor(type, intensity) : null;
  const kcal = met && minutes ? round(netExerciseKcal(met, usedWeight, minutes), 0) : 0;
  const shown = filter ? options.filter((o) => normalize(o.name).includes(normalize(filter))) : options;
  const setup = { typeKey, minutes, intensity, note: note.trim() || null };

  /** Fills the form from a template or an earlier training. */
  function apply(t: { typeKey: string; minutes: number; intensity: Intensity; note: string | null }) {
    if (!options.some((o) => o.key === t.typeKey)) {
      toast.error('Diese Sportart gibt es nicht mehr.');
      return;
    }
    setTypeKey(t.typeKey);
    setIntensity(t.intensity);
    setMinutes(t.minutes);
    setNote(t.note ?? '');
    setFilter('');
  }

  async function save() {
    if (!type || !met || !minutes) return;
    const data = {
      date,
      typeKey: type.key,
      name: type.name,
      minutes,
      intensity,
      met,
      weightKg: usedWeight,
      kcal,
      note: setup.note,
    };
    await saveExercise(db, data, entry ?? null);
    toast.success(`${type.name}: ${fmt0(kcal)} kcal`);
    await navigate({ to: '/', search: { date } });
  }

  return (
    <Page
      title={entry ? 'Training bearbeiten' : 'Training eintragen'}
      back
      withTabBar={false}
      actions={
        entry ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Training löschen"
            onClick={async () => {
              await deleteRecord(db, 'exerciseEntries', entry.id);
              toast(`${entry.name} gelöscht`, {
                action: {
                  label: 'Rückgängig',
                  onClick: () => void restoreRecord(db, 'exerciseEntries', entry.id),
                },
              });
              await navigate({ to: '/', search: { date } });
            }}
          >
            <Trash2 className="text-destructive" aria-hidden />
          </Button>
        ) : undefined
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{fmtDayLong(date)}</p>
      {!entry && ((templates?.length ?? 0) > 0 || (recent?.length ?? 0) > 0) && (
        <Section title="Schnellauswahl">
          <div className="grid gap-3 pb-3">
            {templates && templates.length > 0 && (
              <QuickList title="Vorlagen">
                {templates.map((t) => (
                  <li key={t.id}>
                    <SwipeToDelete
                      label={`Vorlage ${t.name} löschen`}
                      onDelete={async () => {
                        await deleteRecord(db, 'exerciseTemplates', t.id);
                        toast(`Vorlage „${t.name}“ gelöscht`, {
                          action: {
                            label: 'Rückgängig',
                            onClick: () => void restoreRecord(db, 'exerciseTemplates', t.id),
                          },
                        });
                      }}
                    >
                      <QuickItem
                        title={t.name}
                        subtitle={describe(t.typeName, t.minutes, t.intensity, t.note)}
                        selected={sameSetup(setup, t)}
                        onSelect={() => apply(t)}
                      />
                    </SwipeToDelete>
                  </li>
                ))}
              </QuickList>
            )}
            {recent && recent.length > 0 && (
              <QuickList title="Zuletzt">
                {recent.map((r) => (
                  <li key={r.id}>
                    <QuickItem
                      title={r.name}
                      subtitle={describe(null, r.minutes, r.intensity, r.note, r.date)}
                      selected={sameSetup(setup, r)}
                      onSelect={() => apply(r)}
                    />
                  </li>
                ))}
              </QuickList>
            )}
          </div>
        </Section>
      )}
      <Section title="Sportart">
        <div className="grid gap-3 px-4 pb-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              aria-label="Sportart suchen"
              placeholder="Sportart suchen…"
              autoComplete="off"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
            />
          </div>
          <ul
            className="max-h-72 overflow-y-auto overscroll-contain rounded-xl border"
            role="listbox"
            aria-label="Sportarten"
          >
            {shown.map((o) => (
              <li key={o.key} role="option" aria-selected={typeKey === o.key}>
                <button
                  type="button"
                  onClick={() => setTypeKey(o.key)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between px-3 text-left text-sm transition-colors focus-visible:bg-accent focus-visible:outline-none',
                    typeKey === o.key ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                  )}
                >
                  <span>
                    {o.name}
                    {o.custom && <span className="ml-1 text-xs opacity-70">(eigene)</span>}
                  </span>
                  <span className="tabular text-xs opacity-70">MET {fmt1(o.met.moderate)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" onClick={() => setCustomOpen(true)}>
            <Plus aria-hidden /> Eigene Sportart
          </Button>
        </div>
      </Section>

      <Section>
        <div className="grid gap-4 p-4">
          <div className="grid gap-1.5">
            <span className="text-sm font-medium">Intensität</span>
            <ToggleGroup
              type="single"
              variant="outline"
              value={intensity}
              onValueChange={(v) => v && setIntensity(v as Intensity)}
              className="w-full"
              disabled={type?.custom}
            >
              {(['light', 'moderate', 'vigorous'] as const).map((i) => (
                <ToggleGroupItem key={i} value={i} className="flex-1">
                  {INTENSITY_LABELS_DE[i]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <NumberField label="Dauer" unit="Min." value={minutes} onValueChange={setMinutes} integer />
          <div className="flex flex-wrap gap-2">
            {[15, 30, 45, 60, 90].map((m) => (
              <Button
                key={m}
                size="sm"
                variant={minutes === m ? 'default' : 'secondary'}
                onClick={() => setMinutes(m)}
              >
                {m} Min.
              </Button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-note">Notiz (optional)</Label>
            <Textarea
              id="ex-note"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
              placeholder="z. B. Bankdrücken 3 × 8 à 60 kg, Kniebeugen 4 × 10…"
              className="min-h-20"
            />
          </div>
          <div className="rounded-xl bg-muted p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm">Verbrauch (zusätzlich zum Grundumsatz)</span>
              <span className="tabular text-2xl font-bold text-exercise">{fmt0(kcal)} kcal</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              (MET {met ? fmt1(met) : NO_VALUE} − 1) × {fmt1(usedWeight)} kg ×{' '}
              {minutes ? fmt1(minutes / 60) : NO_VALUE} h
              {weight === undefined &&
                !entry &&
                ' · Standardgewicht. Trage dein Gewicht ein für genauere Werte.'}
              {settings?.addExerciseCalories === false &&
                ' · Wird laut Einstellung nicht aufs Tagesziel angerechnet.'}
            </p>
          </div>
          <Button size="lg" disabled={!type || !minutes} onClick={() => void save()}>
            {entry ? 'Änderungen übernehmen' : 'Training speichern'}
          </Button>
          <Button variant="outline" disabled={!type || !minutes} onClick={() => setTemplateOpen(true)}>
            <BookmarkPlus aria-hidden /> Als Vorlage speichern
          </Button>
          <p className="text-xs text-muted-foreground">
            MET-Werte: Compendium of Physical Activities (Ainsworth 2011/Herrmann 2024), gerundet.{' '}
            <Link to="/about" className="underline">
              Quellen
            </Link>
          </p>
        </div>
      </Section>
      {type && minutes && (
        <TemplateDialog
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          defaultName={setup.note ? `${type.name}: ${setup.note.split('\n')[0]!.slice(0, 40)}` : type.name}
          data={{ typeKey: type.key, typeName: type.name, minutes, intensity, note: setup.note }}
        />
      )}
      <CustomTypeDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        onCreated={(id) => {
          setTypeKey(id);
          setIntensity('moderate');
        }}
      />
    </Page>
  );
}

function sameSetup(
  a: { typeKey: string | null; minutes: number | null; intensity: Intensity; note: string | null },
  b: { typeKey: string; minutes: number; intensity: Intensity; note: string | null },
): boolean {
  return (
    a.typeKey === b.typeKey &&
    a.minutes === b.minutes &&
    a.intensity === b.intensity &&
    (a.note ?? null) === (b.note?.trim() || null)
  );
}

function describe(
  typeName: string | null,
  minutes: number,
  intensity: Intensity,
  note: string | null,
  date?: string,
): string {
  return [typeName, `${fmt0(minutes)} Min.`, INTENSITY_LABELS_DE[intensity], date && fmtDate(date), note]
    .filter(Boolean)
    .join(' · ');
}

function QuickList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="px-4 pb-1 text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border/70 border-y border-border/70">{children}</ul>
    </div>
  );
}

function QuickItem({
  title,
  subtitle,
  selected,
  onSelect,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left transition-colors select-none focus-visible:bg-accent focus-visible:outline-none',
        selected ? 'bg-primary/10' : 'hover:bg-accent/60',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  defaultName,
  data,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultName: string;
  data: Omit<ExerciseTemplate, 'id' | 'updatedAt' | 'deleted' | 'name'>;
}) {
  const db = useDb();
  const [name, setName] = useState(defaultName);
  const [prevDefault, setPrevDefault] = useState(defaultName);
  if (defaultName !== prevDefault) {
    setPrevDefault(defaultName);
    setName(defaultName);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Als Vorlage speichern</DialogTitle>
          <DialogDescription>
            Sportart, Dauer, Intensität und Notiz stehen danach unter „Schnellauswahl“ bereit.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="tpl-name">Name</Label>
          <Input
            id="tpl-name"
            autoComplete="off"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Oberkörper-Tag…"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={async () => {
              await saveExerciseTemplate(db, { ...data, name: name.trim() });
              toast.success(`Vorlage „${name.trim()}“ gespeichert`);
              onOpenChange(false);
            }}
          >
            Vorlage speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CustomTypeDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const db = useDb();
  const [name, setName] = useState('');
  const [met, setMet] = useState<number | null>(6);
  const valid = name.trim().length > 0 && met !== null && met >= 1 && met <= 25;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eigene Sportart</DialogTitle>
          <DialogDescription>
            MET = Vielfaches des Ruheumsatzes. Orientierung: Gehen 3,5 · Radfahren 7 · Joggen 10. Werte
            findest du im Compendium of Physical Activities ({EXERCISE_TYPE_MAP.size} Arten sind schon
            enthalten).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ct-name">Name</Label>
            <Input
              id="ct-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Stand-up-Paddling…"
            />
          </div>
          <NumberField
            label="MET-Wert"
            value={met}
            onValueChange={setMet}
            error={met !== null && (met < 1 || met > 25) ? 'Zwischen 1 und 25.' : null}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            disabled={!valid}
            onClick={async () => {
              const id = uuidv7();
              await saveRecord(db, 'exerciseTypes', { id, name: name.trim(), met: met! });
              onCreated(id);
              setName('');
              onOpenChange(false);
            }}
          >
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
