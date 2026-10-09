import { isISODate, today } from '@ft/shared';
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { AddSheetProvider } from '@/components/AddSheet';
import { TabBar } from '@/components/TabBar';
import { ViewportVars } from '@/hooks/useVisualViewport';
import { intoParam } from '@/lib/into';
import { useSessionContext } from './session';
import { AppBanners } from './AppBanners';
import { LoginPage } from '@/features/auth/LoginPage';
import { DiaryPage } from '@/features/diary/DiaryPage';
import { AddFoodPage } from '@/features/foods/AddFoodPage';
import { QuickAddPage } from '@/features/foods/QuickAddPage';
import { CustomFoodsPage } from '@/features/foods/CustomFoodsPage';
import { MealsPage } from '@/features/meals/MealsPage';
import { MorePage } from '@/features/more/MorePage';
import { ProfilePage } from '@/features/more/ProfilePage';
import { MealNamesPage } from '@/features/more/MealNamesPage';
import { AccountPage } from '@/features/more/AccountPage';

// ---------------------------------------------------------------- search param parsing

const dateParam = (v: unknown) => (typeof v === 'string' && isISODate(v) ? v : undefined);
const mealParam = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : 0;
};
const strParam = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length < 100 ? v : undefined);
/** A barcode: the router parses `?code=4006040123453` (typed or shared link) as a number. */
const digitsParam = (v: unknown) =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : strParam(v))?.replace(/\D/g, '') ||
  undefined;

export interface DateSearch {
  date?: string;
}
/** Food search that adds to a saved meal or an AI analysis instead of the diary (see lib/into.ts). */
export interface IntoSearch {
  into?: string;
}
export interface MealSearch {
  date: string;
  meal: number;
}

const validateDate = (s: Record<string, unknown>): DateSearch => clean({ date: dateParam(s.date) });
const validateMeal = (s: Record<string, unknown>): MealSearch => ({
  date: dateParam(s.date) ?? today(),
  meal: mealParam(s.meal),
});

type Opt<T> = { [K in keyof T]?: T[K] };
/** Drops undefined keys so optional params stay out of the URL. */
function clean<T extends Record<string, unknown>>(o: T): Opt<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Opt<T>;
}

// ---------------------------------------------------------------- layout

function RootLayout() {
  return <Outlet />;
}

/**
 * Signed-in area. Pages render their own header; the tab bar sits on the main tabs. The add sheet
 * (tab bar "+") belongs to the layout so any page can open it.
 */
function AuthedLayout() {
  const { session } = useSessionContext();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!session) return <Navigate to="/login" />;
  const showTabs = ['/', '/progress', '/reports', '/more'].includes(path);
  return (
    <AddSheetProvider>
      <ViewportVars />
      <AppBanners />
      <Outlet />
      {showTabs && <TabBar />}
    </AddSheetProvider>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const authed = createRoute({ getParentRoute: () => rootRoute, id: 'authed', component: AuthedLayout });

const r = <P extends string>(path: P) => ({ getParentRoute: () => authed, path }) as const;

export const routes = {
  diary: createRoute({ ...r('/'), validateSearch: validateDate, component: DiaryPage }),
  add: createRoute({
    ...r('/add'),
    validateSearch: (s: Record<string, unknown>): MealSearch & IntoSearch & { tab?: string; q?: string } => ({
      ...validateMeal(s),
      ...clean({ tab: strParam(s.tab), q: strParam(s.q), into: intoParam(s.into) }),
    }),
    component: AddFoodPage,
  }),
  food: createRoute({
    ...r('/food/$foodId'),
    validateSearch: (s: Record<string, unknown>): MealSearch & IntoSearch & { entryId?: string } => ({
      ...validateMeal(s),
      ...clean({ entryId: strParam(s.entryId), into: intoParam(s.into) }),
    }),
    component: lazyRouteComponent(() => import('@/features/foods/FoodLogPage'), 'FoodLogPage'),
  }),
  entry: createRoute({
    ...r('/entry/$entryId'),
    component: lazyRouteComponent(() => import('@/features/foods/FoodLogPage'), 'FoodLogPage'),
  }),
  quickAdd: createRoute({
    ...r('/quick-add'),
    validateSearch: (s: Record<string, unknown>): MealSearch & { entryId?: string } => ({
      ...validateMeal(s),
      ...clean({ entryId: strParam(s.entryId) }),
    }),
    component: QuickAddPage,
  }),
  scan: createRoute({
    ...r('/scan'),
    // `code`: a barcode already read elsewhere (photo page), looked up immediately, camera stays idle.
    validateSearch: (s: Record<string, unknown>): MealSearch & IntoSearch & { code?: string } => ({
      ...validateMeal(s),
      ...clean({ into: intoParam(s.into), code: digitsParam(s.code) }),
    }),
    component: lazyRouteComponent(() => import('@/features/foods/ScanPage'), 'ScanPage'),
  }),
  photo: createRoute({
    ...r('/photo'),
    validateSearch: (s: Record<string, unknown>): MealSearch & { review?: number } => {
      const review = Number(s.review);
      return {
        ...validateMeal(s),
        ...clean({ review: Number.isInteger(review) && review > 0 ? review : undefined }),
      };
    },
    component: lazyRouteComponent(() => import('@/features/ai/PhotoPage'), 'PhotoPage'),
  }),
  customFoods: createRoute({ ...r('/custom-foods'), component: CustomFoodsPage }),
  customFood: createRoute({
    ...r('/custom-food/$id'),
    validateSearch: (
      s: Record<string, unknown>,
    ): {
      barcode?: string;
      name?: string;
      date?: string;
      meal?: number;
      into?: string;
      from?: 'food';
      /** '1': open the label camera right away (scan page, unknown product). */
      label?: '1';
    } =>
      clean({
        from: s.from === 'food' ? ('food' as const) : undefined,
        label: s.label === '1' || s.label === 1 ? ('1' as const) : undefined,
        into: intoParam(s.into),
        barcode: digitsParam(s.barcode),
        name: strParam(s.name),
        date: dateParam(s.date),
        meal: s.meal === undefined ? undefined : mealParam(s.meal),
      }),
    component: lazyRouteComponent(() => import('@/features/foods/CustomFoodPage'), 'CustomFoodPage'),
  }),
  meals: createRoute({ ...r('/meals'), component: MealsPage }),
  trainings: createRoute({
    ...r('/trainings'),
    component: lazyRouteComponent(() => import('@/features/exercise/TrainingsPage'), 'TrainingsPage'),
  }),
  training: createRoute({
    ...r('/trainings/$templateId'),
    component: lazyRouteComponent(
      () => import('@/features/exercise/TrainingEditorPage'),
      'TrainingEditorPage',
    ),
  }),
  meal: createRoute({
    ...r('/meals/$mealId'),
    // `from: 'log'`: the editor was opened from "Meal eintragen" (deleting returns past that page).
    validateSearch: (s: Record<string, unknown>): { date?: string; meal?: number; from?: 'log' } =>
      clean({
        date: dateParam(s.date),
        meal: s.meal === undefined ? undefined : mealParam(s.meal),
        from: s.from === 'log' ? ('log' as const) : undefined,
      }),
    component: lazyRouteComponent(() => import('@/features/meals/MealPage'), 'MealPage'),
  }),
  diaryMeal: createRoute({
    ...r('/diary-meal'),
    validateSearch: validateMeal,
    component: lazyRouteComponent(() => import('@/features/diary/DiaryMealPage'), 'DiaryMealPage'),
  }),
  onboarding: createRoute({
    ...r('/onboarding'),
    component: lazyRouteComponent(() => import('@/features/goals/OnboardingPage'), 'OnboardingPage'),
  }),
  goals: createRoute({
    ...r('/goals'),
    component: lazyRouteComponent(() => import('@/features/goals/GoalsPage'), 'GoalsPage'),
  }),
  progress: createRoute({
    ...r('/progress'),
    validateSearch: (s: Record<string, unknown>): { log?: boolean; range?: string } =>
      clean({ log: s.log === true || s.log === 'true' ? true : undefined, range: strParam(s.range) }),
    component: lazyRouteComponent(() => import('@/features/progress/ProgressPage'), 'ProgressPage'),
  }),
  exercise: createRoute({
    ...r('/exercise'),
    validateSearch: (s: Record<string, unknown>): { date: string; entryId?: string } => ({
      date: dateParam(s.date) ?? today(),
      ...clean({ entryId: strParam(s.entryId) }),
    }),
    component: lazyRouteComponent(() => import('@/features/exercise/ExercisePage'), 'ExercisePage'),
  }),
  completeDay: createRoute({
    ...r('/day/$date/complete'),
    component: lazyRouteComponent(() => import('@/features/day/CompleteDayPage'), 'CompleteDayPage'),
  }),
  reports: createRoute({
    ...r('/reports'),
    validateSearch: (s: Record<string, unknown>): { range?: string; end?: string; metric?: string } =>
      clean({ range: strParam(s.range), end: dateParam(s.end), metric: strParam(s.metric) }),
    component: lazyRouteComponent(() => import('@/features/reports/ReportsPage'), 'ReportsPage'),
  }),
  more: createRoute({ ...r('/more'), component: MorePage }),
  profile: createRoute({ ...r('/settings/profile'), component: ProfilePage }),
  mealNames: createRoute({ ...r('/settings/meals'), component: MealNamesPage }),
  account: createRoute({ ...r('/settings/account'), component: AccountPage }),
  data: createRoute({
    ...r('/settings/data'),
    component: lazyRouteComponent(() => import('@/features/more/DataPage'), 'DataPage'),
  }),
  appearance: createRoute({
    ...r('/settings/appearance'),
    component: lazyRouteComponent(() => import('@/features/more/AppearancePage'), 'AppearancePage'),
  }),
  trash: createRoute({
    ...r('/settings/trash'),
    component: lazyRouteComponent(() => import('@/features/more/TrashPage'), 'TrashPage'),
  }),
  about: createRoute({
    ...r('/about'),
    component: lazyRouteComponent(() => import('@/features/more/AboutPage'), 'AboutPage'),
  }),
};

const routeTree = rootRoute.addChildren([loginRoute, authed.addChildren(Object.values(routes))]);

export const router = createRouter({
  routeTree,
  defaultPreload: false,
  scrollRestoration: true,
  defaultNotFoundComponent: () => <Navigate to="/" />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
