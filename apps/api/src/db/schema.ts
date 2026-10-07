/**
 * PostgreSQL schema (Drizzle, snake_case columns via `casing`). The synced tables mirror the
 * Dexie stores on the device; their TypeScript keys equal the wire keys of the Zod schemas in
 * `@ft/shared`, so a row maps to a wire record by dropping `userId` and `changeSeq`.
 *
 * Every synced table has:
 *   user_id + id   composite primary key (ids are generated on devices)
 *   updated_at     epoch ms of the last write on the device (last write wins)
 *   deleted        tombstone flag
 *   change_seq     server-assigned value from the global `sync_seq` sequence: the pull cursor.
 */
import type { DayTarget, MacroPlan, MealItem, NutrientMap, Portion } from '@ft/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const syncSeq = pgSequence('sync_seq');

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the session token; the token itself is never stored. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    userAgent: text(),
  },
  (t) => [index().on(t.userId)],
);

const syncColumns = () => ({
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  id: text().notNull(),
  updatedAt: bigint({ mode: 'number' }).notNull(),
  deleted: boolean().notNull().default(false),
  changeSeq: bigint({ mode: 'number' })
    .notNull()
    .default(sql`nextval('sync_seq')`),
});

type SyncCols = ReturnType<typeof syncColumns>;
const syncExtras = (t: { [K in keyof SyncCols]: any }) => [
  primaryKey({ columns: [t.userId, t.id] }),
  index().on(t.userId, t.changeSeq),
];

export const userSettings = pgTable(
  'user_settings',
  {
    ...syncColumns(),
    sex: text({ enum: ['male', 'female'] }),
    birthDate: date({ mode: 'string' }),
    heightCm: doublePrecision(),
    activityLevel: text({ enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] }).notNull(),
    targetWeightKg: doublePrecision(),
    weeklyRateKg: doublePrecision().notNull(),
    mealNames: jsonb().$type<string[]>().notNull(),
    addExerciseCalories: boolean().notNull(),
    onboardedAt: bigint({ mode: 'number' }),
    macroPlan: jsonb().$type<MacroPlan>(),
  },
  syncExtras,
);

export const goals = pgTable(
  'goals',
  {
    ...syncColumns(),
    validFrom: date({ mode: 'string' }).notNull(),
    days: jsonb().$type<DayTarget[]>().notNull(),
    micros: jsonb().$type<Record<string, number | null>>().notNull(),
  },
  syncExtras,
);

export const customFoods = pgTable(
  'custom_foods',
  {
    ...syncColumns(),
    name: text().notNull(),
    brand: text(),
    barcode: text(),
    unit: text({ enum: ['g', 'ml'] }).notNull(),
    nutrients: jsonb().$type<NutrientMap>().notNull(),
    portions: jsonb().$type<Portion[]>().notNull(),
  },
  syncExtras,
);

export const foodPortions = pgTable(
  'food_portions',
  {
    ...syncColumns(),
    foodId: text().notNull(),
    label: text().notNull(),
    grams: doublePrecision().notNull(),
  },
  syncExtras,
);

export const meals = pgTable(
  'meals',
  {
    ...syncColumns(),
    name: text().notNull(),
    items: jsonb().$type<MealItem[]>().notNull(),
    photoId: text(),
  },
  syncExtras,
);

export const foodEntries = pgTable(
  'food_entries',
  {
    ...syncColumns(),
    date: date({ mode: 'string' }).notNull(),
    meal: integer().notNull(),
    loggedAt: bigint({ mode: 'number' }).notNull(),
    foodId: text(),
    source: text({ enum: ['bls', 'off', 'custom', 'quick', 'ai'] }).notNull(),
    name: text().notNull(),
    brand: text(),
    grams: doublePrecision(),
    portionLabel: text(),
    portionGrams: doublePrecision(),
    quantity: doublePrecision().notNull(),
    per100: jsonb().$type<NutrientMap>(),
    nutrients: jsonb().$type<NutrientMap>().notNull(),
    mealId: text(),
    aiAnalysisId: text(),
    groupId: text(),
  },
  (t) => [...syncExtras(t), index().on(t.userId, t.date)],
);

export const exerciseTypes = pgTable(
  'exercise_types',
  {
    ...syncColumns(),
    name: text().notNull(),
    met: doublePrecision().notNull(),
  },
  syncExtras,
);

export const exerciseEntries = pgTable(
  'exercise_entries',
  {
    ...syncColumns(),
    date: date({ mode: 'string' }).notNull(),
    typeKey: text().notNull(),
    name: text().notNull(),
    minutes: doublePrecision().notNull(),
    intensity: text({ enum: ['light', 'moderate', 'vigorous'] }).notNull(),
    met: doublePrecision().notNull(),
    weightKg: doublePrecision().notNull(),
    kcal: doublePrecision().notNull(),
    loggedAt: bigint({ mode: 'number' }).notNull(),
    note: text(),
  },
  (t) => [...syncExtras(t), index().on(t.userId, t.date)],
);

export const exerciseTemplates = pgTable(
  'exercise_templates',
  {
    ...syncColumns(),
    name: text().notNull(),
    typeKey: text().notNull(),
    typeName: text().notNull(),
    minutes: doublePrecision().notNull(),
    intensity: text({ enum: ['light', 'moderate', 'vigorous'] }).notNull(),
    note: text(),
  },
  syncExtras,
);

export const weightEntries = pgTable(
  'weight_entries',
  {
    ...syncColumns(),
    date: date({ mode: 'string' }).notNull(),
    kg: doublePrecision().notNull(),
  },
  syncExtras,
);

export const dayNotes = pgTable(
  'day_notes',
  {
    ...syncColumns(),
    date: date({ mode: 'string' }).notNull(),
    note: text().notNull(),
    completedAt: bigint({ mode: 'number' }),
  },
  syncExtras,
);

/** Shared food catalog: BLS (seeded) and Open Food Facts (cached on lookup). Not per user. */
export const foods = pgTable(
  'foods',
  {
    id: text().primaryKey(),
    source: text({ enum: ['bls', 'off'] }).notNull(),
    sourceId: text().notNull(),
    name: text().notNull(),
    nameEn: text(),
    brand: text(),
    group: text(),
    unit: text({ enum: ['g', 'ml'] }).notNull(),
    nutrients: jsonb().$type<NutrientMap>().notNull(),
    portions: jsonb().$type<Portion[]>().notNull(),
    imageUrl: text(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.source, t.sourceId)],
);

/** Barcodes OFF does not know (cached briefly so repeated scans don't hit the rate limit). */
export const offMisses = pgTable('off_misses', {
  ean: text().primaryKey(),
  checkedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/** Log of AI photo analyses: cost tracking and later accuracy evaluation (photos are not stored). */
export const aiAnalyses = pgTable(
  'ai_analyses',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    model: text().notNull(),
    userText: text(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    costUsd: doublePrecision().notNull(),
    durationMs: integer().notNull(),
    result: jsonb().notNull(),
  },
  (t) => [index().on(t.userId, t.createdAt)],
);

export const appMeta = pgTable('app_meta', {
  key: text().primaryKey(),
  value: text().notNull(),
});

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Meal photos (immutable: a changed photo gets a new id). Not part of the LWW sync: records only
 * reference them by `photoId`; devices upload/download them via `/api/photos/:id`.
 */
export const photos = pgTable(
  'photos',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    mime: text().notNull(),
    bytes: integer().notNull(),
    data: bytea().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

/** Wire table name → Drizzle table. */
export const syncTables = {
  settings: userSettings,
  goals,
  customFoods,
  foodPortions,
  meals,
  foodEntries,
  exerciseTypes,
  exerciseEntries,
  exerciseTemplates,
  weightEntries,
  dayNotes,
} as const;
