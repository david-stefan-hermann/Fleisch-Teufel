import { get, N, uuidv7, type Food, type Meal, type Portion } from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ChevronDown, Globe, LoaderCircle, Plus, Search, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { EmptyState, Page } from '@/components/Page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addFoodToDraft } from '@/db/aiDraft';
import type { UserDb } from '@/db/dexie';
import { addItemToMeal } from '@/db/entries';
import { addItemToGroupDraft } from '@/db/groupDraft';
import { mealItem } from '@/db/mealDraft';
import { deleteRecord, saveRecord } from '@/db/write';
import {
  filterOwn,
  getFood,
  mergeOnline,
  recentAndFrequent,
  rowAmount,
  searchLocal,
  searchOnline,
  customToFood,
  type FoodUsage,
  type RecentFood,
  type SearchRow,
} from '@/foods/foodService';
import { useSettings, useToday } from '@/hooks/data';
import { useSubmitting } from '@/hooks/useSubmitting';
import { ApiError, OfflineError } from '@/lib/api';
import { fmt0 } from '@/lib/format';
import { parseInto, type Into } from '@/lib/into';
import { entryAmountLabel } from '@/features/diary/MealCard';
import { warmUpCamera } from '@/components/cameraWarmup';

type Tab = 'frequent' | 'recent' | 'mine';
const TABS: { id: Tab; label: string }[] = [
  { id: 'frequent', label: 'Häufig' },
  { id: 'recent', label: 'Kürzlich' },
  { id: 'mine', label: 'Eigene' },
];
const DEFAULT_TAB: Tab = 'frequent';

/** Remembers whether the "Meals" section under "Eigene" is open (per device, default open). */
const MEALS_OPEN_KEY = 'ft:addfood:mealsOpen';
function readMealsOpen(): boolean {
  try {
    return localStorage.getItem(MEALS_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}
function writeMealsOpen(open: boolean) {
  try {
    localStorage.setItem(MEALS_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* private mode: just not remembered */
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function AddFoodPage() {
  const search = useSearch({ from: '/authed/add' });
  const navigate = useNavigate({ from: '/add' });
  const db = useDb();
  const today = useToday();
  const settings = useSettings();
  const { date, meal } = search;
  const into = parseInto(search.into);
  /** Search params for links to the food page / scanner: keep the target (diary meal or `into`). */
  const linkSearch: FoodLinkSearch = { date, meal, ...(search.into ? { into: search.into } : {}) };
  const tab = TABS.find((t) => t.id === search.tab)?.id ?? DEFAULT_TAB;
  const [query, setQuery] = useState(search.q ?? '');
  const q = useDebounced(query.trim(), 150);
  const qOnline = useDebounced(query.trim(), 600);
  // From 2 characters on, the search results replace the tab content of "Häufig" and "Kürzlich".
  // "Eigene" stays selected and only filters the user's own foods and meals (no BLS, no online).
  const searching = q.length >= 2 && tab !== 'mine';
  const filteringOwn = q.length >= 2 && tab === 'mine';

  const history = useLiveQuery(() => recentAndFrequent(db, today), [db, today]);
  // Saved meals cannot be part of a saved meal, an AI review or a diary group.
  const withMeals = !into;
  // Waits for the history so that previously logged foods rank first from the first result on.
  const local = useLiveQuery(
    async () => (searching && history ? searchLocal(db, q, 40, history.usage, { meals: withMeals }) : null),
    [db, q, searching, history, withMeals],
  );
  const portionList = useLiveQuery(() => db.foodPortions.filter((p) => !p.deleted).toArray(), [db]);
  const userPortions = useMemo(() => {
    const first = new Map<string, Portion>();
    for (const p of portionList ?? []) if (!first.has(p.foodId)) first.set(p.foodId, p);
    return first;
  }, [portionList]);
  const [result, setResult] = useState<{
    q: string;
    foods: Food[];
    state: 'done' | 'offline' | 'limited' | 'error';
  } | null>(null);
  const wantsOnline = searching && qOnline.length >= 3;
  // Results belong to the query they were fetched for; anything else is still loading.
  const online: {
    q: string;
    foods: Food[];
    state: 'loading' | 'done' | 'offline' | 'limited' | 'error';
  } | null = !wantsOnline
    ? null
    : result?.q === qOnline
      ? result
      : { q: qOnline, foods: [], state: 'loading' };
  useEffect(() => {
    if (!wantsOnline) return;
    const ctrl = new AbortController();
    searchOnline(qOnline, ctrl.signal).then(
      (r) => setResult({ q: qOnline, foods: r.foods, state: r.limited ? 'limited' : 'done' }),
      (e) => {
        if (ctrl.signal.aborted) return;
        setResult({
          q: qOnline,
          foods: [],
          state: e instanceof OfflineError ? 'offline' : e instanceof ApiError ? 'error' : 'offline',
        });
      },
    );
    return () => ctrl.abort();
  }, [qOnline, wantsOnline]);

  const custom = useLiveQuery(() => db.customFoods.filter((f) => !f.deleted).sortBy('name'), [db]);
  const meals = useLiveQuery(() => db.meals.filter((m) => !m.deleted).sortBy('name'), [db]);

  const own = useMemo(
    () => (custom && meals ? filterOwn(filteringOwn ? q : '', custom, into ? [] : meals) : null),
    [custom, meals, q, filteringOwn, into],
  );

  // Online products join the list once they belong to the query the local results are for.
  const onlineFoods = online && online.q === q ? online.foods : null;
  // Until the answer for the current query is there (debounce included), the online search loads.
  const onlineState = q.length < 3 ? null : online?.q === q ? online.state : 'loading';
  const rows = useMemo(
    () => (local ? mergeOnline(local.rows, onlineFoods ?? [], q, history?.usage) : null),
    [local, onlineFoods, q, history],
  );
  const mealName = settings?.mealNames[meal] ?? 'Mahlzeit';

  const [mealsOpen, setMealsOpen] = useState(readMealsOpen);
  const toggleMeals = (open: boolean) => {
    setMealsOpen(open);
    writeMealsOpen(open);
  };

  const setTab = (t: Tab) => {
    // Picking a tab while search results are shown leaves the search.
    setQuery('');
    void navigate({
      search: (s) => ({ ...s, q: undefined, tab: t === DEFAULT_TAB ? undefined : t }),
      replace: true,
    });
  };

  const { run } = useSubmitting();
  /** "+" on a recent food: logs the last amount again, with undo like every diary action. */
  async function quickRelog(r: RecentFood) {
    if (into) {
      if (await addRecentToTarget(db, into, r, date)) toast.success(`${r.name} hinzugefügt`);
      else
        toast.error(
          into.kind === 'group' ? 'Den Eintrag gibt es nicht mehr.' : 'Das Meal gibt es nicht mehr.',
        );
      return;
    }
    const { id: _id, updatedAt: _u, deleted: _d, ...rest } = r.last;
    const id = uuidv7();
    await saveRecord(db, 'foodEntries', {
      ...rest,
      id,
      date,
      meal,
      loggedAt: Date.now(),
      mealId: null,
      aiAnalysisId: null,
      groupId: null,
      groupName: null,
      photoId: null,
      photoIds: null,
    });
    toast.success(`${r.name} eingetragen`, {
      action: { label: 'Rückgängig', onClick: () => void deleteRecord(db, 'foodEntries', id) },
    });
  }

  return (
    <Page
      title={into ? 'Zutat hinzufügen' : `Zu ${mealName}`}
      back
      withTabBar={false}
      actions={
        into ? undefined : (
          <Button variant="ghost" size="icon" asChild>
            {/* Replaces the page: switching between search and food page never piles up history. */}
            <Link
              to="/photo"
              preload="intent"
              onClick={warmUpCamera}
              search={{ date, meal }}
              replace
              aria-label="Foto oder Barcode"
            >
              <Camera className="size-6" aria-hidden />
            </Link>
          </Button>
        )
      }
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
              aria-label="Lebensmittel suchen"
              placeholder={
                tab === 'mine'
                  ? 'Eigene Lebensmittel und Meals suchen…'
                  : 'Lebensmittel suchen, z. B. Haferflocken…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {/* No tab is active while search results are shown; tapping one returns to it. "Eigene" stays
              active and filters its own list. */}
          <Tabs value={searching ? '' : tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="grid w-full grid-cols-3">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  // Radix ignores a click on the active tab; while searching none is active.
                  onClick={() => searching && t.id === tab && setTab(t.id)}
                  className="px-1 text-xs"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      }
    >
      {searching && (
        <>
          {local?.suggestion && (
            <p className="mb-2 text-sm text-muted-foreground">
              Meintest du{' '}
              <button
                type="button"
                className="min-h-10 font-medium text-primary underline underline-offset-2"
                onClick={() => setQuery(local.suggestion!)}
              >
                „{local.suggestion}“
              </button>
              ?
            </p>
          )}
          {rows && rows.length > 0 && (
            <ul className="-mx-4 divide-y divide-border/70">
              {rows.map((r) => (
                <SearchResultRow
                  key={r.id}
                  row={r}
                  usage={history?.usage}
                  userPortions={userPortions}
                  search={linkSearch}
                />
              ))}
            </ul>
          )}
          {rows && rows.length === 0 && onlineState !== 'loading' && (
            <EmptyState icon={<Search />} title={`Nichts gefunden für „${q}“`}>
              Versuche ein allgemeineres Wort (z. B. „Käse“ statt „Bergkäse gerieben“) oder{' '}
              <Link
                to="/custom-food/$id"
                params={{ id: 'new' }}
                search={{ name: q, ...linkSearch }}
                className="text-primary underline"
              >
                lege ein eigenes Lebensmittel an
              </Link>
              .
            </EmptyState>
          )}
          <OnlineStatus state={onlineState} short={q.length < 3} />
        </>
      )}

      {!searching && tab === 'recent' && (
        <RecentList
          items={history?.recent}
          search={linkSearch}
          onQuick={(r) => void run(() => quickRelog(r))}
        />
      )}
      {!searching && tab === 'frequent' && (
        <RecentList
          items={history?.frequent}
          search={linkSearch}
          onQuick={(r) => void run(() => quickRelog(r))}
          showCount
          empty="Was du mindestens zweimal einträgst, erscheint hier zum schnellen Wiederverwenden."
        />
      )}

      {tab === 'mine' && own && filteringOwn && (
        <>
          {own.meals.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Meals ({own.meals.length})</h2>
              <div className="mb-4">
                <MealList meals={own.meals} date={date} meal={meal} />
              </div>
            </>
          )}
          {own.custom.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Eigene Lebensmittel</h2>
              <ul className="-mx-4 divide-y divide-border/70">
                {own.custom.map((c) => (
                  <FoodRow key={c.id} food={customToFood(c)} search={linkSearch} />
                ))}
              </ul>
            </>
          )}
          {own.meals.length === 0 && own.custom.length === 0 && (
            <EmptyState icon={<Search />} title="Nichts Eigenes gefunden">
              Unter „Eigene“ suchst du nur in deinen Lebensmitteln und Meals.{' '}
              <Link
                to="/custom-food/$id"
                params={{ id: 'new' }}
                search={{ name: q, ...linkSearch }}
                className="text-primary underline"
              >
                Eigenes Lebensmittel anlegen
              </Link>
            </EmptyState>
          )}
        </>
      )}

      {tab === 'mine' && !filteringOwn && (
        <>
          {/* Saved meals cannot be part of a saved meal, an AI review or a diary group. */}
          {!into && (
            <Collapsible open={mealsOpen} onOpenChange={toggleMeals} className="mb-4">
              <CollapsibleTrigger className="group -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between rounded-lg px-2 text-sm font-semibold text-muted-foreground hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
                <span>Meals{meals ? ` (${meals.length})` : ''}</span>
                <ChevronDown
                  className="size-5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                  aria-hidden
                />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <MealList meals={meals} date={date} meal={meal} />
              </CollapsibleContent>
            </Collapsible>
          )}
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Eigene Lebensmittel</h2>
          <Button variant="outline" className="mb-3 w-full" asChild>
            <Link to="/custom-food/$id" params={{ id: 'new' }} search={linkSearch}>
              <Plus aria-hidden /> Eigenes Lebensmittel anlegen
            </Link>
          </Button>
          {custom && custom.length === 0 && (
            <EmptyState title="Noch keine eigenen Lebensmittel">
              Lege Rezepte von zu Hause oder Produkte ohne Barcode-Eintrag an.
            </EmptyState>
          )}
          <ul className="-mx-4 divide-y divide-border/70">
            {custom?.map((c) => (
              <FoodRow key={c.id} food={customToFood(c)} search={linkSearch} />
            ))}
          </ul>
        </>
      )}
    </Page>
  );
}

type FoodLinkSearch = { date: string; meal: number; into?: string };

/**
 * "+" on a recent food in `into` mode: same amount as last time, into the meal / analysis / diary
 * group (`date` is the group's day). Returns false when the target is gone.
 */
async function addRecentToTarget(db: UserDb, into: Into, r: RecentFood, date: string): Promise<boolean> {
  const item = mealItem(r.last);
  if (into.kind === 'meal') return addItemToMeal(db, into.mealId, item);
  if (into.kind === 'group') return addItemToGroupDraft(db, into.groupId, date, item);
  const food = await getFood(db, r.foodId);
  if (food) await addFoodToDraft(db, into.localId, food, item.grams ?? 100);
  return true;
}

/** Below the results: what the online search for branded products (Open Food Facts) is doing. */
function OnlineStatus({
  state,
  short,
}: {
  state: 'loading' | 'done' | 'offline' | 'limited' | 'error' | null;
  short: boolean;
}) {
  const text =
    state === 'loading'
      ? 'Suche Markenprodukte…'
      : state === 'offline'
        ? 'Offline: nur lokale Ergebnisse. Markenprodukte und Barcode-Scan wieder, sobald du verbunden bist.'
        : state === 'limited'
          ? 'Open Food Facts ist ausgelastet, zeige zwischengespeicherte Produkte.'
          : state === 'error'
            ? 'Open Food Facts antwortet gerade nicht.'
            : short
              ? 'Ab 3 Zeichen werden auch Markenprodukte gesucht.'
              : 'Markenprodukte: Open Food Facts.';
  return (
    <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
      {state === 'loading' ? (
        <LoaderCircle className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : state === 'offline' ? (
        <WifiOff className="size-4 shrink-0" aria-hidden />
      ) : (
        <Globe className="size-4 shrink-0" aria-hidden />
      )}
      <span role="status">{text}</span>
    </p>
  );
}

/** "3× gegessen": how often the person logged the food in the last 90 days. */
function UsageBadge({ count }: { count: number }) {
  return (
    <Badge variant="secondary" className="px-1.5 py-0 text-[11px]" aria-label={`${count}× gegessen`}>
      {count}× gegessen
    </Badge>
  );
}

function SearchResultRow({
  row,
  usage,
  userPortions,
  search,
}: {
  row: SearchRow;
  usage: FoodUsage | undefined;
  userPortions: Map<string, Portion>;
  search: FoodLinkSearch;
}) {
  if (row.kind === 'meal') {
    const m = row.meal;
    return (
      <li>
        <Link
          to="/meals/$mealId"
          params={{ mealId: m.id }}
          search={{ date: search.date, meal: search.meal }}
          className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
        >
          <MealPhoto photoId={m.photoId} alt="" className="size-10 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 font-medium break-words">{m.name}</div>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="px-1.5 py-0 text-[11px]">
                Meal
              </Badge>
              <span className="truncate">{m.items.map((i) => i.name).join(', ')}</span>
            </div>
          </div>
          <div className="tabular shrink-0 text-right">
            <div className="font-semibold">
              {fmt0(m.items.reduce((s, i) => s + get(i.nutrients, N.kcal), 0))}
            </div>
            <div className="text-[11px] text-muted-foreground">kcal</div>
          </div>
        </Link>
      </li>
    );
  }
  return (
    <FoodRow food={row.food} search={search} usage={usage} userPortion={userPortions.get(row.food.id)} />
  );
}

function FoodRow({
  food,
  search,
  usage,
  userPortion,
}: {
  food: Food;
  search: FoodLinkSearch;
  usage?: FoodUsage;
  userPortion?: Portion;
}) {
  const unit = food.unit === 'ml' ? 'ml' : 'g';
  const count = usage?.get(food.id)?.count ?? 0;
  const amount = rowAmount(food, usage, userPortion);
  const origin = food.brand ?? (food.source === 'bls' ? 'BLS' : food.source === 'custom' ? 'Eigenes' : null);
  return (
    <li>
      <Link
        to="/food/$foodId"
        params={{ foodId: food.id }}
        search={search}
        className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 font-medium break-words">{food.name}</div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {count > 0 && <UsageBadge count={count} />}
            <span className="truncate">{[origin, amount?.label].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="tabular shrink-0 text-right">
          <div className="font-semibold">{fmt0(amount ? amount.kcal : get(food.nutrients, N.kcal))}</div>
          <div className="text-[11px] text-muted-foreground">
            {amount ? 'kcal' : <>kcal/100&nbsp;{unit}</>}
          </div>
        </div>
      </Link>
    </li>
  );
}

function MealList({ meals, date, meal }: { meals: Meal[] | undefined; date: string; meal: number }) {
  if (!meals) return null;
  if (meals.length === 0)
    return (
      <p className="py-2 text-sm text-muted-foreground text-pretty">
        Noch keine gespeicherten Meals. Öffne im Tagebuch eine Mahlzeit und tippe oben auf das Speichern-Icon,
        um sie als Meal abzulegen.
      </p>
    );
  return (
    <ul className="-mx-4 divide-y divide-border/70">
      {meals.map((m) => (
        <li key={m.id}>
          <Link
            to="/meals/$mealId"
            params={{ mealId: m.id }}
            search={{ date, meal }}
            className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
          >
            <MealPhoto photoId={m.photoId} alt="" className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{m.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {m.items.map((i) => i.name).join(', ')}
              </div>
            </div>
            <div className="tabular font-semibold">
              {fmt0(m.items.reduce((s, i) => s + get(i.nutrients, N.kcal), 0))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function RecentList({
  items,
  search,
  onQuick,
  showCount,
  empty = 'Was du einträgst, erscheint hier zum schnellen Wiederverwenden.',
}: {
  items: RecentFood[] | undefined;
  search: FoodLinkSearch;
  onQuick: (r: RecentFood) => void;
  showCount?: boolean;
  empty?: string;
}) {
  if (!items) return null;
  if (items.length === 0) return <EmptyState title="Noch keine Einträge">{empty}</EmptyState>;
  return (
    <ul className="-mx-4 divide-y divide-border/70">
      {items.map((r) => (
        <li key={r.foodId} className="flex items-center">
          <Link
            to="/food/$foodId"
            params={{ foodId: r.foodId }}
            search={search}
            className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-4 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{r.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[r.brand, entryAmountLabel(r.last), showCount ? `${r.count}× eingetragen` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <div className="tabular font-semibold">{fmt0(get(r.last.nutrients, N.kcal))}</div>
          </Link>
          <Button
            variant="ghost"
            size="icon-lg"
            className="mr-2 text-primary"
            onClick={() => onQuick(r)}
            aria-label={`${r.name} mit gleicher Menge eintragen`}
          >
            <Plus aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}
