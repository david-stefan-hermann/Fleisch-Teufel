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
  EXERCISE_TYPE_MAP,
  metFor,
  netExerciseKcal,
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

const food = async (id: string): Promise<Food> =>
  ((await (await call(`/api/foods/${encodeURIComponent(id)}`, { cookie })).json()) as { food: Food }).food;

// Typical German meals from the BLS (code, label, grams, portion).
const plan: { meal: number; items: [string, number, string?][] }[] = [
  {
    meal: 0,
    items: [
      ['C133000', 60],
      ['M141100', 200],
      ['F503100', 150, 'Apfel'],
    ],
  },
  {
    meal: 1,
    items: [
      ['E411000', 250],
      ['V411180', 150],
      ['G620100', 150],
    ],
  },
  {
    meal: 2,
    items: [
      ['B140000', 100, 'Scheibe'],
      ['M5B1600', 40],
      ['G550100', 120],
    ],
  },
  { meal: 3, items: [['H710100', 30]] },
];
const ids = [...new Set(plan.flatMap((p) => p.items.map((i) => i[0])))];
const foods = new Map<string, Food>();
for (const code of ids) {
  try {
    foods.set(code, await food(`bls:${code}`));
  } catch {
    /* code may not exist; skipped below */
  }
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
    weeklyRateKg: -0.5,
    mealNames: [...DEFAULT_MEAL_NAMES],
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
  if (d === 41 && rnd() > 2) continue;
  let i = 0;
  for (const m of plan) {
    if (m.meal === 3 && rnd() > 0.6) continue;
    for (const [code, grams] of m.items) {
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
          meal: m.meal,
          loggedAt: now + d * 100 + i++,
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
  }
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
        kcal: round(netExerciseKcal(met, kg, 45), 0),
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
