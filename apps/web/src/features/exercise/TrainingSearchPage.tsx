import {
  DEFAULT_WEIGHT_KG,
  metFor,
  normalize,
  trainingItemsOf,
  trainingKcal,
  trainingSummary,
  type ExerciseTemplate,
} from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Bookmark, Pin, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDb } from '@/app/session';
import { Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { readTrainingDraft, startNewTraining } from '@/db/trainingDraft';
import {
  trainingHistory,
  trainingKey,
  type TrainingHistory,
  type TrainingValues,
} from '@/db/trainingSuggestions';
import { useCurrentWeight } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { fmt0 } from '@/lib/format';
import { trainingTarget } from '@/lib/into';
import { cn } from '@/lib/utils';
import {
  DEFAULT_SPORT_VALUES,
  describeValues,
  matchesTraining,
  useTrainings,
  useTypeOptions,
  type TypeOption,
} from './training';
import { CustomTypeDialog } from './TrainingFields';

type Tab = 'frequent' | 'recent' | 'mine';
const TABS: { id: Tab; label: string }[] = [
  { id: 'frequent', label: 'Häufig' },
  { id: 'recent', label: 'Kürzlich' },
  { id: 'mine', label: 'Eigene' },
];
const DEFAULT_TAB: Tab = 'frequent';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** A row of the search: a saved training or a sport. */
type Row =
  | { kind: 'training'; key: string; training: ExerciseTemplate; kcal: number; count: number }
  | { kind: 'sport'; key: string; type: TypeOption; values: TrainingValuesLike; kcal: number; count: number };
type TrainingValuesLike = Pick<TrainingValues, 'minutes' | 'intensity'>;

/**
 * "Training eintragen" (`/exercise`): one search for sports and saved trainings, like the food
 * search (`/add`): tabs "Häufig · Kürzlich · Eigene" with the same mechanics (from two characters the
 * text searches everything and no tab is active; a tap on a tab filters the text there and shows an
 * x; a tap on the active tab searches everything again). "Häufig" ends with every sport A to Z. A tap
 * on a row opens the sport page or "Training eintragen" of the saved training. With
 * `into=training:<id>` (the editor's "Aktivität hinzufügen") only sports are listed.
 */
export function TrainingSearchPage() {
  const search = useSearch({ from: '/authed/exercise' });
  const navigate = useNavigate({ from: '/exercise' });
  const db = useDb();
  const { date } = search;
  const intoId = trainingTarget(search.into);
  const target = useLiveQuery(
    async () => (intoId ? ((await db.exerciseTemplates.get(intoId)) ?? null) : null),
    [db, intoId],
  );
  // A new training has only its draft (and maybe already a name there).
  const targetDraftName = useLiveQuery(
    async () => (intoId ? (await readTrainingDraft(db, intoId))?.name : null),
    [db, intoId],
  );
  const tab = TABS.find((t) => t.id === search.tab)?.id ?? DEFAULT_TAB;
  const [query, setQuery] = useState(search.q ?? '');
  const q = useDebounced(query.trim(), 150);
  useEffect(() => {
    if ((search.q ?? '') === q) return;
    void navigate({
      search: (s) => ({ ...s, q: q || undefined, ...(q.length < 2 && { scope: undefined }) }),
      replace: true,
      resetScroll: false,
    });
  }, [q, search.q, navigate]);
  const typing = q.length >= 2;
  const filter: Tab | null = !typing
    ? null
    : search.scope === 'all'
      ? null
      : (search.scope ?? (tab === 'mine' ? 'mine' : null));

  const options = useTypeOptions();
  const trainings = useTrainings();
  const weight = useCurrentWeight(date) ?? DEFAULT_WEIGHT_KG;
  const history = useLiveQuery(
    () => trainingHistory(db, date, { withLogged: true, limit: Number.POSITIVE_INFINITY }),
    [db, date],
  );
  const [customName, setCustomName] = useState<string | null>(null);

  const rows = useMemo(
    () => (history && trainings ? buildRows(options, trainings, history, weight, !!intoId) : null),
    [options, trainings, history, weight, intoId],
  );

  const pickTab = (t: Tab) => {
    const tabParam = t === DEFAULT_TAB ? undefined : t;
    const scope = query.trim().length < 2 ? undefined : t === filter ? ('all' as const) : t;
    void navigate({
      search: (s) => ({ ...s, scope, ...(scope !== 'all' && { tab: tabParam }) }),
      replace: true,
      resetScroll: false,
    });
  };

  const { busy, run } = useSubmitting();
  const newTraining = () =>
    run(async () => {
      const templateId = await startNewTraining(db);
      await navigate({ to: '/trainings/$templateId', params: { templateId } });
    });

  const linkSearch = { date, ...(search.into ? { into: search.into } : {}) };
  const matches = (r: Row) =>
    r.kind === 'training'
      ? matchesTraining(q, [r.training.name, ...trainingItemsOf(r.training).map((i) => i.typeName)])
      : normalize(r.type.name).includes(normalize(q));
  const shown = (list: Row[]) => (typing ? list.filter(matches) : list);

  const targetName = target?.name || targetDraftName || 'Training';
  const custom = rows?.all.filter((r) => r.kind === 'sport' && r.type.custom) ?? [];
  const createRow = typing && (
    <li>
      <button
        type="button"
        onClick={() => setCustomName(q)}
        className="flex min-h-12 w-full items-center gap-2 px-4 text-left text-primary hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Eigene Sportart „{q}“ anlegen</span>
      </button>
    </li>
  );

  let body: ReactNode = null;
  if (rows) {
    if (typing && filter === null) {
      const found = rows.all.filter(matches).sort(byUse);
      body = (
        <RowList rows={found} search={linkSearch}>
          {createRow}
        </RowList>
      );
    } else if ((filter ?? tab) === 'frequent') {
      const frequent = shown(rows.frequent);
      const rest = shown(rows.az.filter((r) => !rows.frequent.some((f) => f.key === r.key)));
      body = (
        <>
          {frequent.length > 0 && <RowList rows={frequent} search={linkSearch} />}
          {rest.length > 0 && <RowList caption="Alle Sportarten" rows={rest} search={linkSearch} />}
          {typing && frequent.length + rest.length === 0 && <Nothing />}
        </>
      );
    } else if ((filter ?? tab) === 'recent') {
      const recent = shown(rows.recent);
      body = recent.length > 0 ? <RowList rows={recent} search={linkSearch} /> : <Nothing typing={typing} />;
    } else {
      const saved = intoId ? [] : shown(rows.saved);
      const own = shown(custom);
      body = (
        <>
          {!intoId && (
            <RowList caption="Trainings" rows={saved} search={linkSearch}>
              <li className="px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void newTraining()}
                >
                  <Plus aria-hidden /> Neues Training
                </Button>
              </li>
            </RowList>
          )}
          <RowList caption="Eigene Sportarten" rows={own} search={linkSearch}>
            <li className="px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setCustomName(typing ? q : '')}
              >
                <Plus aria-hidden /> Eigene Sportart
              </Button>
            </li>
          </RowList>
        </>
      );
    }
  }

  return (
    <Page
      title={intoId ? `Zu „${targetName}“ hinzufügen` : 'Training eintragen'}
      back
      withTabBar={false}
      headerExtra={
        <div className="grid gap-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-label={intoId ? 'Sportart suchen' : 'Sportart oder Training suchen'}
              placeholder={intoId ? 'Sportart suchen…' : 'Sportart oder Training suchen…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* Like the food search: everything runs on the click (see AddFoodPage). */}
          <Tabs value={filter ?? (typing ? '' : tab)}>
            <TabsList className="grid w-full grid-cols-3">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  onClick={() => pickTab(t.id)}
                  aria-label={t.id === filter ? `${t.label}, Filter aufheben` : undefined}
                  className="relative px-1 text-xs"
                >
                  {t.label}
                  {t.id === filter && (
                    <X className="absolute top-1 right-1 size-3 text-muted-foreground" aria-hidden />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      }
    >
      {body}
      <CustomTypeDialog
        key={customName ?? ''}
        open={customName !== null}
        defaultName={customName ?? ''}
        onOpenChange={(o) => !o && setCustomName(null)}
        onCreated={(typeKey) =>
          void navigate({ to: '/sport/$typeKey', params: { typeKey }, search: linkSearch })
        }
      />
    </Page>
  );
}

/** Most used first, then by name (a typed search). */
const byUse = (a: Row, b: Row) => b.count - a.count || rowName(a).localeCompare(rowName(b), 'de');
const rowName = (r: Row) => (r.kind === 'training' ? r.training.name : r.type.name);

function Nothing({ typing }: { typing?: boolean }) {
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {typing ? 'Nichts gefunden.' : 'Noch nichts eingetragen.'}
    </p>
  );
}

/**
 * The lists of the search from the history: "Häufig" (suggestions: pinned first, then by score),
 * "Kürzlich" (by last date), all sports A to Z, the saved trainings, and everything for typing. With
 * `sportsOnly` (adding an activity to a saved training) saved trainings are left out.
 */
function buildRows(
  options: readonly TypeOption[],
  trainings: readonly ExerciseTemplate[],
  history: TrainingHistory,
  weightKg: number,
  sportsOnly: boolean,
) {
  const count = (key: string) => history.stats.get(key)?.count ?? 0;
  const sportRow = (type: TypeOption): Row => {
    const last = history.last.get(type.key);
    const values = last ?? DEFAULT_SPORT_VALUES;
    const intensity = type.custom ? 'moderate' : values.intensity;
    return {
      kind: 'sport',
      key: type.key,
      type,
      values: { minutes: values.minutes, intensity },
      kcal: trainingKcal(metFor(type, intensity), weightKg, values.minutes),
      count: count(type.key),
    };
  };
  const trainingRow = (t: ExerciseTemplate): Row => ({
    kind: 'training',
    key: trainingKey(t.id, t.typeKey),
    training: t,
    kcal: trainingItemsOf(t).reduce((sum, i) => {
      const type = options.find((o) => o.key === i.typeKey);
      return type ? sum + trainingKcal(metFor(type, i.intensity), weightKg, i.minutes) : sum;
    }, 0),
    count: count(trainingKey(t.id, t.typeKey)),
  });
  const sports = new Map(options.map((o) => [o.key, sportRow(o)]));
  const saved = sportsOnly ? [] : trainings.map(trainingRow);
  const byKey = new Map<string, Row>([...sports, ...saved.map((r) => [r.key, r] as const)]);
  const frequent = history.suggestions.flatMap((s) => byKey.get(s.key) ?? []);
  const recent = [...history.stats]
    .sort(([, a], [, b]) => b.lastDate.localeCompare(a.lastDate))
    .flatMap(([key]) => byKey.get(key) ?? []);
  const az = [...sports.values()].sort((a, b) => rowName(a).localeCompare(rowName(b), 'de'));
  return { frequent, recent, az, saved, all: [...saved, ...az] };
}

function RowList({
  caption,
  rows,
  search,
  children,
}: {
  caption?: string;
  rows: Row[];
  search: { date: string; into?: string };
  children?: ReactNode;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border/70 bg-card">
      {caption && (
        <h2 className="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {caption}
        </h2>
      )}
      <ul className="divide-y divide-border/70">
        {rows.map((r) => (
          <SearchRow key={r.key} row={r} search={search} />
        ))}
        {children}
      </ul>
    </section>
  );
}

function SearchRow({ row, search }: { row: Row; search: { date: string; into?: string } }) {
  const className =
    'flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none';
  const tail = (
    <div className="tabular shrink-0 text-right">
      <div className="font-semibold">{fmt0(row.kcal)} kcal</div>
      {row.count > 0 && (
        <div className="text-[11px] text-muted-foreground">{fmt0(row.count)}× eingetragen</div>
      )}
    </div>
  );
  if (row.kind === 'training') {
    const t = row.training;
    const Icon = t.pinned === true ? Pin : Bookmark;
    return (
      <li>
        <Link
          to="/trainings/$templateId"
          params={{ templateId: t.id }}
          search={{ date: search.date }}
          className={className}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-medium">
              <Icon
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t.pinned === true ? 'angepinnt' : 'gespeichert'}
              />
              <span className="truncate">{t.name}</span>
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {trainingSummary(trainingItemsOf(t))}
            </div>
          </div>
          {tail}
        </Link>
      </li>
    );
  }
  return (
    <li>
      <Link to="/sport/$typeKey" params={{ typeKey: row.type.key }} search={search} className={cn(className)}>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{row.type.name}</div>
          <div className="truncate text-xs text-muted-foreground">{describeValues(row.values)}</div>
        </div>
        {tail}
      </Link>
    </li>
  );
}
