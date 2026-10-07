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
import { TabBar } from '@/components/TabBar';
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

export interface DateSearch {
  date?: string;
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

/** Signed-in area. Pages render their own header; the tab bar sits on the main tabs. */
function AuthedLayout() {
  const { session } = useSessionContext();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!session) return <Navigate to="/login" />;
  const showTabs = ['/', '/progress', '/reports', '/more'].includes(path);
  return (
    <>
      <AppBanners />
      <Outlet />
      {showTabs && <TabBar />}
    </>
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
    validateSearch: (s: Record<string, unknown>): MealSearch & { tab?: string; q?: string } => ({
      ...validateMeal(s),
      ...clean({ tab: strParam(s.tab), q: strParam(s.q) }),
    }),
    component: AddFoodPage,
  }),
  food: createRoute({
    ...r('/food/$foodId'),
    validateSearch: (s: Record<string, unknown>): MealSearch & { entryId?: string } => ({
      ...validateMeal(s),
      ...clean({ entryId: strParam(s.entryId) }),
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
    validateSearch: validateMeal,
    component: lazyRouteComponent(() => import('@/features/foods/ScanPage'), 'ScanPage'),
  }),
  photo: createRoute({
    ...r('/photo'),
    validateSearch: validateMeal,
    component: lazyRouteComponent(() => import('@/features/ai/PhotoPage'), 'PhotoPage'),
  }),
  customFoods: createRoute({ ...r('/custom-foods'), component: CustomFoodsPage }),
  customFood: createRoute({
    ...r('/custom-food/$id'),
    validateSearch: (
      s: Record<string, unknown>,
    ): { barcode?: string; name?: string; date?: string; meal?: number } =>
      clean({
        barcode: strParam(s.barcode),
        name: strParam(s.name),
        date: dateParam(s.date),
        meal: s.meal === undefined ? undefined : mealParam(s.meal),
      }),
    component: lazyRouteComponent(() => import('@/features/foods/CustomFoodPage'), 'CustomFoodPage'),
  }),
  meals: createRoute({
    ...r('/meals'),
    validateSearch: (s: Record<string, unknown>): { date?: string; meal?: number } =>
      clean({ date: dateParam(s.date), meal: s.meal === undefined ? undefined : mealParam(s.meal) }),
    component: MealsPage,
  }),
  meal: createRoute({
    ...r('/meals/$mealId'),
    validateSearch: (s: Record<string, unknown>): { date?: string; meal?: number } =>
      clean({ date: dateParam(s.date), meal: s.meal === undefined ? undefined : mealParam(s.meal) }),
    component: lazyRouteComponent(() => import('@/features/meals/MealPage'), 'MealPage'),
  }),
  copyMeal: createRoute({
    ...r('/copy-meal'),
    validateSearch: validateMeal,
    component: lazyRouteComponent(() => import('@/features/meals/CopyMealPage'), 'CopyMealPage'),
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
