import { get, N, uuidv7, type Food, type Meal, type Portion } from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Globe, LoaderCircle, Plus, Search, WifiOff, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  filterRecent,
  getFood,
  mergeOnline,
  ownBarcodes,
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
import { parseFoodInto, type FoodInto } from '@/lib/into';
import { entryAmountLabel } from '@/features/diary/MealCard';

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
  const into = parseFoodInto(search.into);
  /** Search params for links to the food page / scanner: keep the target (diary meal or `into`). */
  const linkSearch: FoodLinkSearch = { date, meal, ...(search.into ? { into: search.into } : {}) };
  const tab = TABS.find((t) => t.id === search.tab)?.id ?? DEFAULT_TAB;
  const [query, setQuery] = useState(search.q ?? '');
  const q = useDebounced(query.trim(), 150);
  const qOnline = useDebounced(query.trim(), 600);
  // The typed text lives in the URL too (debounced, replace): opening a result and coming back keeps it.
  // A filter belongs to the text: below two characters it is gone.
  useEffect(() => {
    if ((search.q ?? '') === q) return;
    void navigate({
      search: (s) => ({ ...s, q: q || undefined, ...(q.length < 2 && { scope: undefined }) }),
      replace: true,
      resetScroll: false,
    });
  }, [q, search.q, navigate]);
  // From 2 characters on the text searches everything and no tab is active. A tap on a tab keeps the
  // text and searches only there (`scope`); a tap on that active tab searches everything again
  // (`scope: 'all'`). Typing on "Eigene" filters the own foods and meals right away (no BLS, no online).
  const typing = q.length >= 2;
  const filter: Tab | null = !typing
    ? null
    : search.scope === 'all'
      ? null
      : (search.scope ?? (tab === 'mine' ? 'mine' : null));
  const searching = typing && filter === null;
  const filteringOwn = filter === 'mine';

  const history = useLiveQuery(() => recentAndFrequent(db, today), [db, today]);
  // A saved meal goes into a meal, an AI review or a diary group as its ingredients; only not into itself.
  const ownMealId = into?.kind === 'meal' ? into.mealId : null;
  // Waits for the history so that previously logged foods rank first from the first result on.
  const local = useLiveQuery(
    async () => (searching && history ? searchLocal(db, q, 40, history.usage, { meals: true }) : null),
    [db, q, searching, history],
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
    /** How many rows were on the screen when the answer came: they keep their place. */
    pinned: number;
  } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wantsOnline = searching && qOnline.length >= 3;
  // Results belong to the query they were fetched for; anything else is still loading.
  const online: {
    q: string;
    foods: Food[];
    state: 'loading' | 'done' | 'offline' | 'limited' | 'error';
    pinned: number;
  } | null = !wantsOnline
    ? null
    : result?.q === qOnline
      ? result
      : { q: qOnline, foods: [], state: 'loading', pinned: 0 };
  useEffect(() => {
    if (!wantsOnline) return;
    const ctrl = new AbortController();
    searchOnline(qOnline, ctrl.signal).then(
      (r) =>
        setResult({
          q: qOnline,
          foods: r.foods,
          state: r.limited ? 'limited' : 'done',
          pinned: rowsOnScreen(listRef.current, qOnline),
        }),
      (e) => {
        if (ctrl.signal.aborted) return;
        setResult({
          q: qOnline,
          foods: [],
          state: e instanceof OfflineError ? 'offline' : e instanceof ApiError ? 'error' : 'offline',
          pinned: 0,
        });
      },
    );
    return () => ctrl.abort();
  }, [qOnline, wantsOnline]);

  const custom = useLiveQuery(() => db.customFoods.filter((f) => !f.deleted).sortBy('name'), [db]);
  const meals = useLiveQuery(
    () => db.meals.filter((m) => !m.deleted && m.id !== ownMealId).sortBy('name'),
    [db, ownMealId],
  );

  const own = useMemo(
    () => (custom && meals ? filterOwn(filteringOwn ? q : '', custom, meals) : null),
    [custom, meals, q, filteringOwn],
  );

  // Online products join the list once they belong to the query the local results are for.
  const onlineFoods = online && online.q === q ? online.foods : null;
  const pinned = online && online.q === q ? online.pinned : 0;
  // Until the answer for the current query is there (debounce included), the online search loads.
  const onlineState = q.length < 3 ? null : online?.q === q ? online.state : 'loading';
  const rows = useMemo(
    () =>
      local
        ? mergeOnline(
            local.rows.filter((r) => r.kind !== 'meal' || r.meal.id !== ownMealId),
            onlineFoods ?? [],
            q,
            history?.usage,
            ownBarcodes(custom ?? []),
            pinned,
          )
        : null,
    [local, onlineFoods, pinned, q, history, custom, ownMealId],
  );
  const filtered = useMemo(
    () =>
      (filter === 'recent' || filter === 'frequent') && history ? filterRecent(q, history[filter]) : null,
    [filter, history, q],
  );
  const mealName = settings?.mealNames[meal] ?? 'Mahlzeit';

  const [mealsOpen, setMealsOpen] = useState(readMealsOpen);
  const toggleMeals = (open: boolean) => {
    setMealsOpen(open);
    writeMealsOpen(open);
  };

  /** A tap on a tab. The typed text always stays. */
  const pickTab = (t: Tab) => {
    const tabParam = t === DEFAULT_TAB ? undefined : t;
    // Not the debounced text: a tap right after typing already means the search.
    const scope = query.trim().length < 2 ? undefined : t === filter ? ('all' as const) : t;
    void navigate({
      search: (s) => ({ ...s, scope, ...(scope !== 'all' && { tab: tabParam }) }),
      replace: true,
      resetScroll: false,
    });
  };
  const searchEverywhere = () =>
    void navigate({ search: (s) => ({ ...s, scope: 'all' as const }), replace: true, resetScroll: false });

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
          {/* No tab is active while the text searches everything; the tab that filters it is active and
              carries a small x. Everything runs on the click: Radix reports no tap on the active tab,
              and its own change (on mouse down) followed by the click would switch the filter twice. */}
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
            <ul ref={listRef} data-q={q} className="-mx-4 divide-y divide-border/70">
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
          <OnlineStatus state={onlineState} short={q.length < 3} />
        </>
      )}

      {!typing && tab === 'recent' && (
        <RecentList
          items={history?.recent}
          search={linkSearch}
          onQuick={(r) => void run(() => quickRelog(r))}
        />
      )}
      {!typing && tab === 'frequent' && (
        <RecentList
          items={history?.frequent}
          search={linkSearch}
          onQuick={(r) => void run(() => quickRelog(r))}
          showCount
          empty="Noch nichts mehrfach eingetragen"
        />
      )}

      {filtered &&
        (filtered.length > 0 ? (
          <RecentList
            items={filtered}
            search={linkSearch}
            onQuick={(r) => void run(() => quickRelog(r))}
            showCount={filter === 'frequent'}
          />
        ) : (
          <EmptyState
            icon={<Search />}
            title={`Nichts in „${TABS.find((t) => t.id === filter)?.label}“ für „${q}“`}
          >
            <button
              type="button"
              className="min-h-10 font-medium text-primary underline underline-offset-2"
              onClick={searchEverywhere}
            >
              Überall suchen
            </button>
          </EmptyState>
        ))}

      {own && filteringOwn && (
        <>
          {own.meals.length > 0 && (
            <>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Meals ({own.meals.length})</h2>
              <div className="mb-4">
                <MealList meals={own.meals} search={linkSearch} />
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

      {!typing && tab === 'mine' && (
        <>
          <Collapsible open={mealsOpen} onOpenChange={toggleMeals} className="mb-4">
            <CollapsibleTrigger className="group -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between rounded-lg px-2 text-sm font-semibold text-muted-foreground hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
              <span>Meals{meals ? ` (${meals.length})` : ''}</span>
              <ChevronDown
                className="size-5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
                aria-hidden
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <MealList meals={meals} search={linkSearch} />
            </CollapsibleContent>
          </Collapsible>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Eigene Lebensmittel</h2>
          <Button variant="outline" className="mb-3 w-full" asChild>
            <Link to="/custom-food/$id" params={{ id: 'new' }} search={linkSearch}>
              <Plus aria-hidden /> Eigenes Lebensmittel anlegen
            </Link>
          </Button>
          {custom && custom.length === 0 && <EmptyState title="Noch keine eigenen Lebensmittel" />}
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
 * How many result rows of the query `q` have their upper edge on the screen (above the keyboard):
 * the rows the person may be about to tap when the online products arrive.
 */
function rowsOnScreen(list: HTMLUListElement | null, q: string): number {
  if (!list || list.dataset.q !== q) return 0;
  const vv = window.visualViewport;
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  let n = 0;
  for (const row of list.children) if (row.getBoundingClientRect().top < bottom) n++;
  return n;
}

/**
 * "+" on a recent food in `into` mode: same amount as last time, into the meal / analysis / diary
 * group (`date` is the group's day). Returns false when the target is gone.
 */
async function addRecentToTarget(db: UserDb, into: FoodInto, r: RecentFood, date: string): Promise<boolean> {
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
            : 'Markenprodukte: Open Food Facts.';
  // Below 3 characters there is no online search, so nothing to report.
  if (short && (state === 'done' || state === null)) return null;
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
          search={search}
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

function MealList({ meals, search }: { meals: Meal[] | undefined; search: FoodLinkSearch }) {
  if (!meals) return null;
  if (meals.length === 0)
    return <p className="py-2 text-sm text-muted-foreground text-pretty">Noch keine Meals.</p>;
  return (
    <ul className="-mx-4 divide-y divide-border/70">
      {meals.map((m) => (
        <li key={m.id}>
          <Link
            to="/meals/$mealId"
            params={{ mealId: m.id }}
            search={search}
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
  empty = 'Noch keine Einträge',
}: {
  items: RecentFood[] | undefined;
  search: FoodLinkSearch;
  onQuick: (r: RecentFood) => void;
  showCount?: boolean;
  empty?: string;
}) {
  if (!items) return null;
  if (items.length === 0) return <EmptyState title={empty} />;
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
