import { get, N, uuidv7, type Food, type Meal } from '@ft/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ChevronDown, Globe, LoaderCircle, Plus, Search, WifiOff, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useDb } from '@/app/session';
import { MealPhoto } from '@/components/MealPhoto';
import { EmptyState, Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addFoodToDraft } from '@/db/aiDraft';
import type { UserDb } from '@/db/dexie';
import { addItemToMeal } from '@/db/entries';
import { saveRecord } from '@/db/write';
import {
  filterOwn,
  getFood,
  recentAndFrequent,
  searchLocal,
  searchOnline,
  customToFood,
  type RecentFood,
} from '@/foods/foodService';
import { useSettings, useToday } from '@/hooks/data';
import { ApiError, OfflineError } from '@/lib/api';
import { fmt0 } from '@/lib/format';
import { parseInto, type Into } from '@/lib/into';
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
  // Waits for the history so that previously logged foods rank first from the first result on.
  const local = useLiveQuery(
    async () => (searching && history ? searchLocal(db, q, 40, history.usage) : null),
    [db, q, searching, history],
  );
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

  const localIds = useMemo(() => new Set((local ?? []).map((h) => h.food.id)), [local]);
  const onlineFoods = (online?.q === qOnline ? online.foods : []).filter((f) => !localIds.has(f.id));
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

  async function quickRelog(r: RecentFood) {
    if (into) {
      await addRecentToTarget(db, into, r);
      toast.success(`${r.name} hinzugefügt`);
      return;
    }
    const { id: _id, updatedAt: _u, deleted: _d, ...rest } = r.last;
    await saveRecord(db, 'foodEntries', {
      ...rest,
      id: uuidv7(),
      date,
      meal,
      loggedAt: Date.now(),
      mealId: null,
      aiAnalysisId: null,
      groupId: null,
    });
    toast.success(`${r.name} zu ${mealName} hinzugefügt`);
  }

  return (
    <Page
      title={into ? 'Zutat hinzufügen' : `Zu ${mealName}`}
      back
      withTabBar={false}
      actions={
        into ? undefined : (
          <>
            <Button variant="ghost" size="icon" asChild>
              <Link to="/photo" search={{ date, meal }} aria-label="Foto analysieren">
                <Camera className="size-6" aria-hidden />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <Link to="/quick-add" search={{ date, meal }} aria-label="Schnell hinzufügen">
                <Zap className="size-6" aria-hidden />
              </Link>
            </Button>
          </>
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
          {local && local.length > 0 && (
            <ul className="-mx-4 divide-y divide-border/70">
              {local.map((h) => (
                <FoodRow key={h.food.id} food={h.food} search={linkSearch} />
              ))}
            </ul>
          )}
          {local &&
            local.length === 0 &&
            (online?.state !== 'done' || onlineFoods.length === 0) &&
            online?.state !== 'loading' && (
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
          <div className="mt-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Globe className="size-4" aria-hidden /> Markenprodukte (Open Food Facts)
              {online?.state === 'loading' && (
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-label="Lädt…" />
              )}
            </h2>
            {online?.state === 'offline' && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <WifiOff className="size-4" aria-hidden /> Offline: nur lokale Ergebnisse. Barcode-Scan
                funktioniert, sobald du wieder verbunden bist.
              </p>
            )}
            {online?.state === 'limited' && (
              <p className="mb-2 text-xs text-muted-foreground">
                Open Food Facts ist ausgelastet, zeige zwischengespeicherte Produkte.
              </p>
            )}
            {online?.state === 'error' && (
              <p className="text-sm text-muted-foreground">Open Food Facts antwortet gerade nicht.</p>
            )}
            {qOnline.length < 3 && (
              <p className="text-sm text-muted-foreground">Ab 3 Zeichen wird auch online gesucht.</p>
            )}
            {onlineFoods.length > 0 && (
              <ul className="-mx-4 divide-y divide-border/70">
                {onlineFoods.map((f) => (
                  <FoodRow key={f.id} food={f} search={linkSearch} />
                ))}
              </ul>
            )}
            {online?.state === 'done' && onlineFoods.length === 0 && (
              <p className="text-sm text-muted-foreground">Keine weiteren Produkte gefunden.</p>
            )}
          </div>
        </>
      )}

      {!searching && tab === 'recent' && (
        <RecentList items={history?.recent} search={linkSearch} onQuick={quickRelog} />
      )}
      {!searching && tab === 'frequent' && (
        <RecentList
          items={history?.frequent}
          search={linkSearch}
          onQuick={quickRelog}
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
          {/* Saved meals cannot be part of a saved meal or an AI review. */}
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

/** "+" on a recent food in `into` mode: same amount as last time, into the meal / analysis. */
async function addRecentToTarget(db: UserDb, into: Into, r: RecentFood): Promise<void> {
  const { foodId, source, name, brand, grams, portionLabel, portionGrams, quantity, per100, nutrients } =
    r.last;
  if (into.kind === 'meal') {
    await addItemToMeal(db, into.mealId, {
      foodId,
      source,
      name,
      brand,
      grams,
      portionLabel,
      portionGrams,
      quantity,
      per100,
      nutrients,
    });
    return;
  }
  const food = await getFood(db, r.foodId);
  if (food) await addFoodToDraft(db, into.localId, food, grams ?? 100);
}

function FoodRow({ food, search }: { food: Food; search: FoodLinkSearch }) {
  const unit = food.unit === 'ml' ? 'ml' : 'g';
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
          <div className="truncate text-xs text-muted-foreground">
            {[
              food.brand,
              food.source === 'bls' ? 'BLS' : food.source === 'custom' ? 'Eigenes' : null,
              food.group && food.source === 'bls' ? food.group : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <div className="tabular shrink-0 text-right">
          <div className="font-semibold">{fmt0(get(food.nutrients, N.kcal))}</div>
          <div className="text-[11px] text-muted-foreground">kcal/100&nbsp;{unit}</div>
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
        Noch keine gespeicherten Meals. Speichere eine Mahlzeit im Tagebuch über das ⋮-Menü „Als Meal
        speichern“, um sie mit einem Tipp erneut einzutragen.
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
