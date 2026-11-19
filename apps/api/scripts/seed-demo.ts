/**
 * Creates a demo account with six weeks of plausible data through the real sync API
 * (for screenshots and manual testing). Needs a running dev server with registration open.
 *
 *   pnpm --filter @ft/api seed:demo [baseUrl]      (default http://localhost:3000)
 * Login afterwards: demo@fleisch-teufel.local / demo-password
 */
import {
  addDays,
  computeItem,
  dayId,
  DEFAULT_MEAL_NAMES,
  eatenAtOf,
  EXERCISE_TYPE_MAP,
  metFor,
  STEPS_MET,
  STEPS_TYPE_KEY,
  stepsValues,
  trainingKcal,
  round,
  today,
  uniformWeek,
  uuidv7,
  type Food,
} from '@ft/shared';

const base = process.argv[2] ?? 'http://localhost:3000';
const email = 'demo@fleisch-teufel.local';
const password = 'demo-password';

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(base + path, { ...init, headers });
  return res;
}

let res = await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
if (res.status === 409 || res.status === 403)
  res = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
if (!res.ok) throw new Error(`auth failed: ${res.status} ${await res.text()}`);
const cookie = /ft_session=[^;]+/.exec(res.headers.get('set-cookie') ?? '')![0];

const food = async (id: string): Promise<Food | undefined> => {
  const r = await call(`/api/foods/${encodeURIComponent(id)}`, { cookie });
  return r.ok ? ((await r.json()) as { food: Food }).food : undefined;
};

// Typical German meals from the BLS (code, grams) at their usual time of day.
const plan: { meal: number; at: [number, number]; items: [string, number][] }[] = [
  {
    meal: 0,
    at: [7, 30],
    items: [
      ['C133000', 60],
      ['M141100', 200],
      ['F503100', 150],
    ],
  },
  {
    meal: 1,
    at: [12, 30],
    items: [
      ['C352032', 250],
      ['V416182', 150],
      ['G620100', 150],
    ],
  },
  {
    meal: 2,
    at: [18, 45],
    items: [
      ['B271000', 100],
      ['M5B1600', 40],
      ['G561100', 120],
    ],
  },
  { meal: 3, at: [15, 30], items: [['H120100', 30]] },
];
const SNACK = 3;
// Days in diary meals of their own (records in `diaryMeals`): two "Snacks", and an own name.
const twoSnacks: [number, number][] = [
  [10, 15],
  [16, 0],
];
const OWN_MEAL = 'Kuchen bei Oma';
const ownMeal: { at: [number, number]; items: [string, number][] } = {
  at: [15, 0],
  items: [
    ['D480200', 120],
    ['F503100', 100],
  ],
};
const ids = [
  ...new Set([...plan.flatMap((p) => p.items.map((i) => i[0])), ...ownMeal.items.map((i) => i[0])]),
];
const foods = new Map<string, Food>();
for (const code of ids) {
  // A code the catalog does not have is skipped below.
  const f = await food(`bls:${code}`).catch(() => undefined);
  if (f) foods.set(code, f);
}

const t = today();
const records: { table: string; data: Record<string, unknown> }[] = [];
const now = Date.now();
const start = addDays(t, -41);
records.push({
  table: 'settings',
  data: {
    id: 'profile',
    updatedAt: now,
    deleted: false,
    sex: 'male',
    birthDate: '1990-05-01',
    heightCm: 182,
    activityLevel: 'light',
    targetWeightKg: 80,
    // Goal "Abnehmen": −0,5 % a week of the demo's end weight (about 83 kg).
    weeklyRateKg: -0.41,
    goalKind: 'lose',
    mealNames: [...DEFAULT_MEAL_NAMES],
    customMealNames: [OWN_MEAL],
    addExerciseCalories: true,
    onboardedAt: now,
  },
});
const week = uniformWeek({ kcal: 2100, proteinG: 150, fatG: 70, carbsG: 215 });
week[5] = { kcal: 2400, proteinG: 150, fatG: 85, carbsG: 250 };
week[6] = { kcal: 2400, proteinG: 150, fatG: 85, carbsG: 250 };
records.push({
  table: 'goals',
  data: { id: dayId.goal(start), updatedAt: now, deleted: false, validFrom: start, days: week, micros: {} },
});

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let kg = 85.6;
for (let d = 0; d <= 41; d++) {
  const date = addDays(start, d);
  kg += -0.07 + (rnd() - 0.5) * 0.5;
  if (rnd() > 0.2)
    records.push({
      table: 'weightEntries',
      data: { id: dayId.weight(date), updatedAt: now, deleted: false, date, kg: round(kg, 1) },
    });
  const minute = () => Math.round((rnd() - 0.5) * 30);
  const logItems = (
    items: readonly (readonly [string, number])[],
    meal: number,
    eatenAt: number,
    diaryMealId: string | null,
  ) => {
    let i = 0;
    for (const [code, grams] of items) {
      const f = foods.get(code);
      if (!f) continue;
      const g = round(grams * (0.8 + rnd() * 0.4), 0);
      const { nutrients } = computeItem({
        per100: f.nutrients,
        portionLabel: '1 g',
        portionGrams: 1,
        quantity: g,
      });
      records.push({
        table: 'foodEntries',
        data: {
          id: uuidv7(),
          updatedAt: now,
          deleted: false,
          date,
          meal,
          diaryMealId,
          // Logged while eating, a minute apart.
          loggedAt: eatenAt + i++ * 60_000,
          foodId: f.id,
          source: 'bls',
          name: f.name,
          brand: null,
          grams: g,
          portionLabel: '1 g',
          portionGrams: 1,
          quantity: g,
          per100: f.nutrients,
          nutrients,
          mealId: null,
          aiAnalysisId: null,
        },
      });
    }
  };
  // A diary meal with a record of its own (a new meal as the app writes it).
  const ownRecord = (name: string, slot: number, eatenAt: number) => {
    const id = uuidv7();
    records.push({
      table: 'diaryMeals',
      data: { id, updatedAt: now, deleted: false, date, name, eatenAt, slot, timeEdited: false },
    });
    return id;
  };
  for (const m of plan) {
    const eatenAt = eatenAtOf(date, m.at[0], m.at[1] + minute());
    // Today only up to now.
    if (eatenAt > now) continue;
    if (m.meal === SNACK) {
      if (d % 7 === 3) {
        // Two meals named "Snacks": both write index 3 and stay apart.
        for (const [h, min] of twoSnacks) {
          const at = eatenAtOf(date, h, min + minute());
          if (at <= now) logItems(m.items, SNACK, at, ownRecord(DEFAULT_MEAL_NAMES[SNACK]!, SNACK, at));
        }
        continue;
      }
      // On a day with the own meal (index 3 as well) a snack without a record would join it.
      if (rnd() > 0.6 || d % 7 === 5) continue;
    }
    // Everything else as entries without a record: the meal of their index.
    logItems(m.items, m.meal, eatenAt, null);
  }
  if (d % 7 === 5) {
    const at = eatenAtOf(date, ownMeal.at[0], ownMeal.at[1] + minute());
    // Breakfast, lunch and dinner hold indexes 0 to 2: an own name shares index 3 with the snacks.
    if (at <= now) logItems(ownMeal.items, SNACK, at, ownRecord(OWN_MEAL, SNACK, at));
  }
  // Steps as the Apple Health shortcut sends them (one record per day under `s:<date>`).
  const steps = Math.round(4_000 + rnd() * 8_000);
  const distance = Math.round(steps * (0.68 + rnd() * 0.1));
  const sv = stepsValues({ steps, distanceM: distance, weightKg: round(kg, 1) });
  records.push({
    table: 'exerciseEntries',
    data: {
      id: dayId.steps(date),
      updatedAt: now,
      deleted: false,
      date,
      typeKey: STEPS_TYPE_KEY,
      name: 'Schritte',
      minutes: sv.minutes,
      intensity: 'moderate',
      met: STEPS_MET,
      weightKg: round(kg, 1),
      kcal: sv.kcal,
      loggedAt: now,
      steps,
      distanceM: sv.distanceM,
    },
  });
  if (d % 3 === 0) {
    const type = EXERCISE_TYPE_MAP.get(d % 6 === 0 ? 'running' : 'strength')!;
    const met = metFor(type, 'moderate');
    records.push({
      table: 'exerciseEntries',
      data: {
        id: uuidv7(),
        updatedAt: now,
        deleted: false,
        date,
        typeKey: type.key,
        name: type.name,
        minutes: 45,
        intensity: 'moderate',
        met,
        weightKg: round(kg, 1),
        // From the stored weight, so the entry counts as computed (not typed kcal).
        kcal: trainingKcal(met, round(kg, 1), 45),
        loggedAt: now,
      },
    });
  }
}

for (let i = 0; i < records.length; i += 500) {
  const r = await call('/api/sync/push', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ records: records.slice(i, i + 500) }),
  });
  const body = (await r.json()) as { applied: number; rejected: unknown[] };
  if (body.rejected.length) console.warn('rejected', body.rejected.slice(0, 3));
}
console.log(
  `Demo data: ${records.length} records for ${email} (password: ${password}); ${foods.size}/${ids.length} foods found.`,
);
