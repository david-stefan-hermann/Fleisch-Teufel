/**
 * Zod schemas shared by client and server. They describe the *wire* shape of every synced
 * entity (camelCase, no `userId`, no server cursor) and the API payloads.
 *
 * Sync rules (see docs/sync.md): every synced record has
 * - `id`: generated on the device (UUID v7) or deterministic for one-per-day records
 *   (`w:2026-10-07` for weights, `n:…` for notes, `g:…` for goals, `profile` for settings)
 * - `updatedAt`: epoch ms of the last local change (last write wins)
 * - `deleted`: soft delete (tombstone), so deletions sync too.
 */
import { z } from 'zod';
import { isISODate } from './dates.js';
import { MACRO_PRESET_IDS } from './tdee.js';
import { MICRO_NUTRIENTS } from './nutrients.js';

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9:_.-]+$/, 'invalid id');

export const isoDateSchema = z.string().refine(isISODate, 'expected YYYY-MM-DD');

export const nutrientMapSchema = z
  .record(z.string().min(1).max(16), z.number().finite())
  .refine((m) => Object.keys(m).length <= 200, 'too many nutrients');

export const portionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  grams: z.number().positive().max(100_000),
});
export type Portion = z.infer<typeof portionSchema>;

const base = {
  id: idSchema,
  updatedAt: z.number().int().nonnegative(),
  deleted: z.boolean(),
};

export const sexSchema = z.enum(['male', 'female']);
export const activityLevelSchema = z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']);
export const foodSourceSchema = z.enum(['bls', 'off', 'custom']);
export type FoodSource = z.infer<typeof foodSourceSchema>;
export const entrySourceSchema = z.enum(['bls', 'off', 'custom', 'quick', 'ai']);
export type EntrySource = z.infer<typeof entrySourceSchema>;
export const intensitySchema = z.enum(['light', 'moderate', 'vigorous']);

export const MEAL_COUNT = 4;
export const DEFAULT_MEAL_NAMES = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'] as const;
export const SETTINGS_ID = 'profile';

// ---------------------------------------------------------------- synced entities

export const settingsSchema = z.object({
  ...base,
  sex: sexSchema.nullable(),
  birthDate: isoDateSchema.nullable(),
  heightCm: z.number().min(50).max(272).nullable(),
  activityLevel: activityLevelSchema,
  targetWeightKg: z.number().min(20).max(400).nullable(),
  weeklyRateKg: z.number().min(-1.5).max(1),
  mealNames: z.array(z.string().trim().min(1).max(40)).length(MEAL_COUNT),
  addExerciseCalories: z.boolean(),
  onboardedAt: z.number().int().nullable(),
  /** Chosen macro template (goal editor). Defaults to null for records from older app versions. */
  macroPlan: z
    .object({
      preset: z.enum(MACRO_PRESET_IDS),
      proteinPerKg: z.number().min(0.5).max(3.5),
      fatPct: z.number().min(10).max(70).nullable(),
      carbsPct: z.number().min(0).max(80).nullable(),
    })
    .nullable()
    .default(null),
});
export type Settings = z.infer<typeof settingsSchema>;

export const dayTargetSchema = z.object({
  kcal: z.number().min(0).max(20_000),
  proteinG: z.number().min(0).max(2000),
  fatG: z.number().min(0).max(2000),
  carbsG: z.number().min(0).max(4000),
});
export type DayTarget = z.infer<typeof dayTargetSchema>;

export const microTargetsSchema = z.partialRecord(
  z.enum(MICRO_NUTRIENTS),
  z.number().min(0).max(1000).nullable(),
);

export const goalSchema = z.object({
  ...base,
  validFrom: isoDateSchema,
  /** Index 0 = Monday … 6 = Sunday. */
  days: z.array(dayTargetSchema).length(7),
  micros: microTargetsSchema,
});
export type Goal = z.infer<typeof goalSchema>;

export const customFoodSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable(),
  barcode: z
    .string()
    .regex(/^\d{6,14}$/)
    .nullable(),
  unit: z.enum(['g', 'ml']),
  /** Per 100 g / 100 ml. */
  nutrients: nutrientMapSchema,
  portions: z.array(portionSchema).max(30),
});
export type CustomFood = z.infer<typeof customFoodSchema>;

/** User-defined portion sizes for any food (BLS has none, OFF often only one). */
export const foodPortionSchema = z.object({
  ...base,
  foodId: idSchema,
  label: z.string().trim().min(1).max(80),
  grams: z.number().positive().max(100_000),
});
export type FoodPortion = z.infer<typeof foodPortionSchema>;

/** One logged item, shared by diary entries and saved meals. Nutrients are copied at log time. */
export const loggedItemShape = {
  foodId: idSchema.nullable(),
  source: entrySourceSchema,
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullable(),
  /** Total grams eaten; null for quick add. */
  grams: z.number().min(0).max(100_000).nullable(),
  portionLabel: z.string().max(80).nullable(),
  portionGrams: z.number().positive().max(100_000).nullable(),
  quantity: z.number().min(0).max(10_000),
  /** Per-100 g values of the food (null for quick add); allows re-scaling when edited. */
  per100: nutrientMapSchema.nullable(),
  /** Absolute nutrients of this item. */
  nutrients: nutrientMapSchema,
};

export const mealItemSchema = z.object(loggedItemShape);
export type MealItem = z.infer<typeof mealItemSchema>;

export const mealSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(120),
  items: z.array(mealItemSchema).min(1).max(100),
  /** Photo stored via `/api/photos` (immutable; a new photo gets a new id). Null for older records. */
  photoId: idSchema.nullable().default(null),
});
export type Meal = z.infer<typeof mealSchema>;

export const foodEntrySchema = z.object({
  ...base,
  ...loggedItemShape,
  date: isoDateSchema,
  meal: z
    .number()
    .int()
    .min(0)
    .max(MEAL_COUNT - 1),
  /** Position inside the meal (log time); keeps order stable across devices. */
  loggedAt: z.number().int().nonnegative(),
  /** Set when logged from a saved meal. */
  mealId: idSchema.nullable(),
  /** Set when logged from an AI photo analysis (for later accuracy evaluation). */
  aiAnalysisId: idSchema.nullable(),
  /**
   * Shared by all entries logged in one action from a saved meal; the diary shows them as one row.
   * Logging the same meal twice gives two groups. Defaults to null for records from older app versions.
   */
  groupId: idSchema.nullable().default(null),
  /**
   * Name of a group logged without a saved meal (AI analysis "Nur eintragen"); the diary row shows it.
   * Null for groups from a saved meal (their name comes from the meal) and for records from older app versions.
   */
  groupName: z.string().trim().max(120).nullable().default(null),
});
export type FoodEntry = z.infer<typeof foodEntrySchema>;

export const exerciseTypeSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(80),
  met: z.number().min(1).max(25),
});
export type CustomExerciseType = z.infer<typeof exerciseTypeSchema>;

export const exerciseEntrySchema = z.object({
  ...base,
  date: isoDateSchema,
  /** Built-in key (`running`) or id of a custom exercise type. */
  typeKey: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(80),
  minutes: z.number().min(1).max(1440),
  intensity: intensitySchema,
  met: z.number().min(1).max(25),
  weightKg: z.number().min(20).max(400),
  /** Net kcal credited to the day ((MET − 1) × kg × h). */
  kcal: z.number().min(0).max(20_000),
  loggedAt: z.number().int().nonnegative(),
  /** Free text, e.g. exercises and sets. Defaults to null for records from older app versions. */
  note: z.string().trim().max(2000).nullable().default(null),
});
export type ExerciseEntry = z.infer<typeof exerciseEntrySchema>;

/** A saved training ("gespeichertes Training"); kcal are computed when it is logged, with the weight of that day. */
export const exerciseTemplateSchema = z.object({
  ...base,
  name: z.string().trim().min(1).max(80),
  typeKey: z.string().min(1).max(64),
  typeName: z.string().trim().min(1).max(80),
  minutes: z.number().min(1).max(1440),
  intensity: intensitySchema,
  note: z.string().trim().max(2000).nullable(),
});
export type ExerciseTemplate = z.infer<typeof exerciseTemplateSchema>;

export const weightEntrySchema = z.object({
  ...base,
  date: isoDateSchema,
  kg: z.number().min(20).max(400),
});
export type WeightEntry = z.infer<typeof weightEntrySchema>;

export const dayNoteSchema = z.object({
  ...base,
  date: isoDateSchema,
  note: z.string().max(5000),
  completedAt: z.number().int().nullable(),
});
export type DayNote = z.infer<typeof dayNoteSchema>;

/** Registry of everything that syncs. Keys are the table names on the wire and in Dexie. */
export const SYNC_SCHEMAS = {
  settings: settingsSchema,
  goals: goalSchema,
  customFoods: customFoodSchema,
  foodPortions: foodPortionSchema,
  meals: mealSchema,
  foodEntries: foodEntrySchema,
  exerciseTypes: exerciseTypeSchema,
  exerciseEntries: exerciseEntrySchema,
  exerciseTemplates: exerciseTemplateSchema,
  weightEntries: weightEntrySchema,
  dayNotes: dayNoteSchema,
} as const;

export type SyncTable = keyof typeof SYNC_SCHEMAS;
export const SYNC_TABLES = Object.keys(SYNC_SCHEMAS) as SyncTable[];
export type SyncRecordMap = { [K in SyncTable]: z.infer<(typeof SYNC_SCHEMAS)[K]> };
export type AnySyncRecord = SyncRecordMap[SyncTable];

export const syncTableSchema = z.enum(SYNC_TABLES as [SyncTable, ...SyncTable[]]);

/** Deterministic ids for one-record-per-day entities, so two offline devices converge. */
export const dayId = {
  weight: (date: string) => `w:${date}`,
  note: (date: string) => `n:${date}`,
  goal: (validFrom: string) => `g:${validFrom}`,
};

// ---------------------------------------------------------------- sync protocol

export const MAX_PUSH_RECORDS = 500;
export const MAX_PULL_RECORDS = 1000;

export const pushRequestSchema = z.object({
  records: z
    .array(z.object({ table: syncTableSchema, data: z.record(z.string(), z.unknown()) }))
    .max(MAX_PUSH_RECORDS),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;

export interface PushResult {
  /** Stored (newer than what the server had). */
  applied: number;
  /** Server already had a newer or equal version; it will arrive via pull. */
  stale: { table: SyncTable; id: string }[];
  /** Invalid records (validation errors); the client drops them from the outbox and reports. */
  rejected: { table: string; id: string | null; error: string }[];
}

export interface PullResult {
  changes: { table: SyncTable; data: AnySyncRecord }[];
  cursor: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------- auth

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, 'Mindestens 8 Zeichen').max(256),
});
export type Credentials = z.infer<typeof credentialsSchema>;

/** Login only needs non-empty values; the length policy applies when setting a password. */
export const loginSchema = credentialsSchema.extend({ password: z.string().min(1).max(256) });

export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface ServerInfo {
  name: string;
  version: string;
  registrationOpen: boolean;
  aiEnabled: boolean;
  blsVersion: string;
}

// ---------------------------------------------------------------- foods (catalog)

/** A food as served by the API / cached on the device. Nutrients per 100 g (or 100 ml). */
export const foodSchema = z.object({
  id: idSchema,
  source: foodSourceSchema,
  sourceId: z.string().nullable(),
  name: z.string(),
  nameEn: z.string().nullable(),
  brand: z.string().nullable(),
  group: z.string().nullable(),
  unit: z.enum(['g', 'ml']),
  nutrients: nutrientMapSchema,
  portions: z.array(portionSchema),
  imageUrl: z.string().nullable().optional(),
});
export type Food = z.infer<typeof foodSchema>;

/**
 * Compact BLS row for the offline client index (tuple keeps the JSON small):
 * [code, nameDe, nameEn, ENERCC, ENERCJ, PROT625, FAT, CHO, FIBT, SUGAR, FASAT, NACL, NA, ALC]
 * Missing values are `null`. The group is derived from the code's first letter.
 */
export type CompactBlsRow = [string, string, string, ...(number | null)[]];

export interface CompactBlsFile {
  version: string;
  keys: string[];
  rows: CompactBlsRow[];
}

// ---------------------------------------------------------------- AI photo analysis

export const aiItemSchema = z.object({
  name: z.string(),
  grams: z.number(),
  confidence: z.enum(['low', 'medium', 'high']),
  preparation: z.string().nullable(),
  packaged: z.boolean(),
  searchTerms: z.array(z.string()),
});
export type AiItem = z.infer<typeof aiItemSchema>;

export interface AiCandidate {
  food: Food;
  score: number;
}

export interface AiAnalysisResult {
  analysisId: string;
  items: (AiItem & { candidates: AiCandidate[] })[];
  /** Short German name of the whole dish ("Spaghetti Bolognese"); null for older results. */
  dishName: string | null;
  notes: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}

/**
 * Ids that must be deterministic so concurrent offline edits on two devices converge
 * on one record instead of creating duplicates. Returns null when any id is fine.
 */
export function requiredId(table: SyncTable, record: Record<string, unknown>): string | null {
  switch (table) {
    case 'settings':
      return SETTINGS_ID;
    case 'weightEntries':
      return dayId.weight(String(record.date));
    case 'dayNotes':
      return dayId.note(String(record.date));
    case 'goals':
      return dayId.goal(String(record.validFrom));
    default:
      return null;
  }
}
