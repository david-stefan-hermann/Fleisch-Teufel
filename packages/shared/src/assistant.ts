/**
 * The assistant ("KI-Assistent"): the person speaks or types a sentence, the server transcribes it and
 * lets the model plan operations, the device carries them out with its own write functions (one Dexie
 * transaction, undo, sync). The server never writes synced tables for it. Everything here is the wire
 * format between device and server, checked on both sides.
 */
import { z } from 'zod';
import { intensitySchema, isoDateSchema, MEAL_COUNT, foodSchema, portionSchema } from './schemas.js';

/** Longest recording the device makes (ms); the last `RECORD_WARN_MS` count down visibly. */
export const MAX_RECORD_MS = 120_000;
export const RECORD_WARN_MS = 10_000;
/** Largest audio upload the server takes (120 s at 32 kbit/s are about 0.5 MB). */
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;
/** Longest typed or transcribed sentence the server takes. */
export const MAX_UTTERANCE_LENGTH = 2000;
/** Recordings stay this long on the server (then only the text). */
export const ASSISTANT_AUDIO_DAYS = 7;

const id = z.string().min(1).max(64);
const meal = z
  .number()
  .int()
  .min(0)
  .max(MEAL_COUNT - 1);
/** No meal named: the device picks one (`logTargetFor`). */
const mealOrNull = meal.nullable();
const grams = z.number().positive().max(10_000);
const ids = z.array(id).min(1).max(100);

/** One food the model chose, with the full food as its search returned it (never values of its own). */
export const assistantFoodItemSchema = z.object({
  food: foodSchema,
  grams,
  /** The portion the person's word matched ("Becher (200 g)"); the entry stores its count. */
  portion: portionSchema.nullable().default(null),
  /** The amount was assumed (a handful, a restaurant portion): the history marks it. */
  guessed: z.boolean().default(false),
});
export type AssistantFoodItem = z.infer<typeof assistantFoodItemSchema>;

export const assistantTrainingItemSchema = z.object({
  /** A sport: built-in key or id of an own sport. */
  typeKey: id.nullable().default(null),
  /** A saved training (`exerciseTemplates` id); its saved activities are logged. */
  templateId: id.nullable().default(null),
  minutes: z.number().min(1).max(1440).nullable().default(null),
  intensity: intensitySchema.nullable().default(null),
});
export type AssistantTrainingItem = z.infer<typeof assistantTrainingItemSchema>;

export const assistantOpSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('logFood'),
    date: isoDateSchema,
    meal: mealOrNull,
    items: z.array(assistantFoodItemSchema).min(1).max(40),
    /** Several items of one dish ("Döner"): logged as one named group. */
    groupName: z.string().trim().max(120).nullable().default(null),
  }),
  /** A food the database does not have, with the model's estimate: becomes a quick entry. */
  z.object({
    kind: z.literal('logEstimate'),
    date: isoDateSchema,
    meal: mealOrNull,
    name: z.string().trim().min(1).max(120),
    grams,
    kcal: z.number().min(0).max(20_000),
    proteinG: z.number().min(0).max(2_000),
    carbsG: z.number().min(0).max(2_000),
    fatG: z.number().min(0).max(2_000),
  }),
  z.object({
    kind: z.literal('logSavedMeal'),
    date: isoDateSchema,
    meal: mealOrNull,
    mealId: id,
  }),
  z.object({
    kind: z.literal('logQuick'),
    date: isoDateSchema,
    meal: mealOrNull,
    kcal: z.number().min(0).max(20_000),
    proteinG: z.number().min(0).max(2_000).nullable().default(null),
    carbsG: z.number().min(0).max(2_000).nullable().default(null),
    fatG: z.number().min(0).max(2_000).nullable().default(null),
    text: z.string().trim().max(1000).default(''),
  }),
  z.object({ kind: z.literal('updateEntry'), entryId: id, grams }),
  z.object({ kind: z.literal('moveEntries'), entryIds: ids, toDate: isoDateSchema, toMeal: meal }),
  z.object({ kind: z.literal('copyEntries'), entryIds: ids, toDate: isoDateSchema, toMeal: mealOrNull }),
  z.object({ kind: z.literal('deleteEntries'), entryIds: ids }),
  z.object({ kind: z.literal('saveMeal'), name: z.string().trim().min(1).max(120), entryIds: ids }),
  z.object({ kind: z.literal('setWeight'), date: isoDateSchema, kg: z.number().min(20).max(400) }),
  z.object({
    kind: z.literal('logTraining'),
    date: isoDateSchema,
    items: z.array(assistantTrainingItemSchema).min(1).max(20),
  }),
  z.object({
    kind: z.literal('openCamera'),
    date: isoDateSchema,
    meal: mealOrNull,
    hint: z.string().trim().max(1000).default(''),
  }),
]);
export type AssistantOp = z.infer<typeof assistantOpSchema>;
export type AssistantOpKind = AssistantOp['kind'];

export const assistantQuestionSchema = z.object({
  text: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(80)).max(4).default([]),
});
export type AssistantQuestion = z.infer<typeof assistantQuestionSchema>;

/** A diary entry as the device describes it to the model (today and yesterday). */
export const contextEntrySchema = z.object({
  id,
  meal,
  name: z.string().max(200),
  /** Null for a quick entry. */
  grams: z.number().nullable(),
  kcal: z.number(),
  proteinG: z.number(),
  /** Name of the group (saved meal or named group) the entry belongs to. */
  group: z.string().max(120).nullable().default(null),
});
export type ContextEntry = z.infer<typeof contextEntrySchema>;

export const contextDaySchema = z.object({
  date: isoDateSchema,
  entries: z.array(contextEntrySchema).max(200),
  trainings: z
    .array(z.object({ id, name: z.string().max(120), minutes: z.number(), intensity: intensitySchema }))
    .max(40),
  weightKg: z.number().nullable(),
});
export type ContextDay = z.infer<typeof contextDaySchema>;

/** One of the last utterances: what was said, done and answered (the model reads follow-ups with it). */
export const recentUtteranceSchema = z.object({
  at: z.string().max(5),
  said: z.string().max(MAX_UTTERANCE_LENGTH),
  done: z.string().max(2000),
  reply: z.string().max(500),
});

/**
 * What the device knows and the server may not yet (the device is the truth: the sync can lag): the
 * time, the diary of today and yesterday with entry ids, targets, the last three utterances, where the
 * previous one wrote and an open question.
 */
export const assistantContextSchema = z.object({
  /** Local time of the utterance, "YYYY-MM-DDTHH:MM". */
  now: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  /** The day the diary showed when the person spoke. */
  shownDate: isoDateSchema,
  mealNames: z.array(z.string().trim().min(1).max(40)).length(MEAL_COUNT),
  targets: z.object({ kcal: z.number().nullable(), proteinG: z.number().nullable() }).nullable(),
  /** Today and yesterday. */
  days: z.array(contextDaySchema).max(2),
  recent: z.array(recentUtteranceSchema).max(3).default([]),
  /** Day and meal the directly previous utterance wrote to. */
  previousTarget: z.object({ date: isoDateSchema, meal }).nullable().default(null),
  openQuestion: assistantQuestionSchema.nullable().default(null),
});
export type AssistantContext = z.infer<typeof assistantContextSchema>;

export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** Answer of `POST /api/assistant/turn`. */
export interface AssistantTurnResult {
  turnId: string;
  transcript: string;
  ops: AssistantOp[];
  question: AssistantQuestion | null;
  /** One short sentence: what was done, or the answer to a question about the data. */
  reply: string | null;
  usage: AssistantUsage;
}

export type AssistantOutcome = 'applied' | 'undone' | 'discarded';

/** One utterance in the history (`GET /api/assistant/turns`). */
export interface AssistantTurnRow {
  id: string;
  createdAt: string;
  source: 'voice' | 'text';
  transcript: string | null;
  ops: AssistantOp[];
  question: AssistantQuestion | null;
  reply: string | null;
  status: 'ok' | 'failed';
  error: string | null;
  outcome: AssistantOutcome | null;
  /** The recording is still on the server (younger than `ASSISTANT_AUDIO_DAYS`). */
  hasAudio: boolean;
}

// ---------------------------------------------------------------- figures (skins)

/** Uploaded figure packs: zip with `skin.json` and pictures. */
export const MAX_SKIN_BYTES = 3 * 1024 * 1024;
export const MAX_SKINS = 5;
export const MAX_SKIN_IMAGES = 40;
export const MAX_SKIN_PX = 512;

export const SKIN_STATES = [
  'idle',
  'typing',
  'listening',
  'warn',
  'thinking',
  'asking',
  'confused',
  'error',
  'done',
  'undone',
  'discarded',
  'carried',
] as const;
export type SkinState = (typeof SKIN_STATES)[number];

const imageKey = z.string().regex(/^[\w-]{1,40}$/);

/** `skin.json` of a figure pack. Only `states.idle` is required; a missing picture keeps the rest picture. */
export const skinManifestSchema = z
  .object({
    format: z.literal('fleisch-teufel-skin'),
    version: z.literal(1),
    name: z.string().trim().min(1).max(40),
    style: z.enum(['free', 'circle']),
    pixelArt: z.boolean().optional(),
    /** Show the thinking dots above the figure (when its thinking picture has none). */
    thinkingDots: z.boolean().optional(),
    images: z.record(imageKey, z.string().regex(/^[\w.-]{1,80}\.(png|webp)$/i)),
    states: z.partialRecord(z.enum(SKIN_STATES), imageKey).refine((s) => !!s.idle, 'states.idle missing'),
    /** Faces the figure shows by itself while it rests. */
    idle: z.array(imageKey).max(30).default([]),
  })
  .refine(
    (m) => [...Object.values(m.states), ...m.idle].every((k) => Object.hasOwn(m.images, k)),
    'unknown image key',
  );
export type SkinManifest = z.infer<typeof skinManifestSchema>;

export interface SkinInfo {
  id: string;
  name: string;
  bytes: number;
  createdAt: string;
}
