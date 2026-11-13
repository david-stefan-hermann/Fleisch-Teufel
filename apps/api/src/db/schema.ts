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
import type {
  AiAnalysisResult,
  AssistantOp,
  AssistantQuestion,
  AssistantTurnResult,
  DayTarget,
  MacroPlan,
  MealItem,
  NutrientMap,
  Portion,
  StepsImportLog,
  TrainingItem,
} from '@ft/shared';
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
  uniqueIndex,
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
    weightStepKg: doublePrecision(),
    weightRangeKg: doublePrecision(),
    stepsMinimum: integer(),
    addStepsCalories: boolean(),
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
    cookedGrams: doublePrecision(),
    purgedAt: bigint({ mode: 'number' }),
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
    groupName: text(),
    photoId: text(),
    photoIds: jsonb().$type<string[]>(),
    note: text(),
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
    templateId: text(),
    groupId: text(),
    steps: integer(),
    distanceM: doublePrecision(),
    purgedAt: bigint({ mode: 'number' }),
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
    extraItems: jsonb().$type<TrainingItem[]>(),
    pinned: boolean(),
    purgedAt: bigint({ mode: 'number' }),
  },
  syncExtras,
);

export const weightEntries = pgTable(
  'weight_entries',
  {
    ...syncColumns(),
    date: date({ mode: 'string' }).notNull(),
    kg: doublePrecision().notNull(),
    purgedAt: bigint({ mode: 'number' }),
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
    /** A failed call is logged too: its rounds were paid for and count towards the budget. */
    status: text({ enum: ['ok', 'failed'] })
      .notNull()
      .default('ok'),
    /** Error code of a failed call (ai_timeout, refused, upstream_error, no_result, upstream_rate_limited). */
    error: text(),
    /** Idempotency key of the device's queue item (meal analysis only). */
    requestId: text(),
    /** The complete answer sent to the device (items with candidates); null for labels, failed calls and older rows. */
    response: jsonb().$type<AiAnalysisResult>(),
  },
  (t) => [
    index().on(t.userId, t.createdAt),
    // A failed call must not block the repetition with the same key.
    uniqueIndex()
      .on(t.userId, t.requestId)
      .where(sql`status = 'ok' and request_id is not null`),
  ],
);

/**
 * Foods a person picked in an AI review instead of the proposed one, by normalized item name. Server
 * only (not synced): the model's food search marks them in later analyses.
 */
export const aiFoodChoices = pgTable(
  'ai_food_choices',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    term: text().notNull(),
    foodId: text().notNull(),
    count: integer().notNull().default(1),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.term, t.foodId] })],
);

/**
 * Web Push subscriptions for the daily reminder ("Erinnerung", one per device): endpoint and keys
 * from the browser, the local time of day and time zone the person chose, and the local date the
 * reminder was last sent for (or skipped because food was logged). Server only, not synced; gone
 * with the account (cascade) or when the push service reports the endpoint as expired.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    endpoint: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    p256dh: text().notNull(),
    auth: text().notNull(),
    /** Local time of day, "HH:MM". */
    remindAt: text().notNull(),
    /** IANA time zone of the device, e.g. "Europe/Berlin". */
    tz: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Local date (YYYY-MM-DD) the reminder was handled for last; one per day at most. */
    lastSentOn: text(),
    /** Delivery errors since the last success (404/410 drop the subscription at once). */
    failures: integer().notNull().default(0),
    /** First delivery error since the last success; after `GIVE_UP_MS` of errors the subscription goes. */
    failingSince: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.userId)],
);

/**
 * Personal access tokens for imports that run outside the app (the iOS shortcut sending steps from
 * Apple Health). Only good for the route of their `kind`, never for the rest of the account; one per
 * user and kind (a new one replaces the old). Server only, survives a password change.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    /** SHA-256 of the token; the token itself is shown once and never stored. */
    id: text().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text({ enum: ['steps'] }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }),
    /** The last calls with this token, newest first (at most `STEPS_LOG_SIZE`). */
    recent: jsonb().$type<StepsImportLog[]>(),
  },
  (t) => [uniqueIndex().on(t.userId, t.kind)],
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
/**
 * Utterances to the assistant: what was said or typed, the device's context, what the model planned
 * and how it ended on the device. The id is the device's `requestId` (unique per user: a repeated
 * request gets `response` again instead of a second paid call). Server only, not synced.
 */
export const assistantTurns = pgTable(
  'assistant_turns',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    source: text({ enum: ['voice', 'text'] }).notNull(),
    /** Transcript of a recording, or the typed sentence; null while only the audio is there. */
    transcript: text(),
    context: jsonb(),
    ops: jsonb().$type<AssistantOp[]>(),
    question: jsonb().$type<AssistantQuestion>(),
    reply: text(),
    status: text({ enum: ['pending', 'ok', 'failed'] })
      .notNull()
      .default('pending'),
    error: text(),
    /** What the device did with the ops (applied, undone, discarded). */
    outcome: text({ enum: ['applied', 'undone', 'discarded'] }),
    /** The complete answer sent to the device (replayed for a repeated request). */
    response: jsonb().$type<AssistantTurnResult>(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index().on(t.userId, t.createdAt)],
);

/** Recordings of utterances, kept `ASSISTANT_AUDIO_DAYS` (`cleanupAssistantAudio`), then only the text. */
export const assistantAudio = pgTable(
  'assistant_audio',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    turnId: text().notNull(),
    mime: text().notNull(),
    bytes: integer().notNull(),
    data: bytea().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.turnId] }), index().on(t.createdAt)],
);

/** Figure packs a person uploaded (zip as sent); devices keep a copy, the active one is chosen per device. */
export const assistantSkins = pgTable(
  'assistant_skins',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    id: text().notNull(),
    name: text().notNull(),
    bytes: integer().notNull(),
    data: bytea().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

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
