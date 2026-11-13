/**
 * Local database (IndexedDB via Dexie). One database per user (`ft-user-<id>`) holds the
 * synced tables (mirror of the Postgres tables), the sync outbox and device-only caches.
 * A shared database (`ft-common`) holds the offline BLS catalog, which is the same for everyone.
 *
 * Keep this file free of `@/` aliases: the API test suite imports it to run real
 * device ↔ server sync tests.
 */
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { LocalPhoto } from './photos';
import type {
  AiAnalysisResult,
  AssistantOp,
  AssistantQuestion,
  SkinManifest,
  AiTypedValues,
  AnySyncRecord,
  CustomExerciseType,
  CustomFood,
  DayNote,
  ExerciseEntry,
  ExerciseTemplate,
  Food,
  FoodEntry,
  FoodPortion,
  Goal,
  Meal,
  Portion,
  Settings,
  SyncTable,
  WeightEntry,
} from '@ft/shared';

export interface OutboxItem {
  /** `${table}:${id}` */
  key: string;
  table: SyncTable;
  id: string;
  /** Version of the record when it was queued; cleared only if unchanged after the push. */
  updatedAt: number;
}

export interface CachedFood extends Food {
  /** Last time the food was opened/logged on this device (for "Kürzlich"). */
  lastUsedAt: number;
}

export interface AiQueueItem {
  localId?: number;
  createdAt: number;
  date: string;
  meal: number;
  text: string;
  /**
   * Legacy (app versions before Dexie v4): the photo inline as Blob. New items keep their photos in
   * `aiPhotos`; `migrateLegacyImages` moves old ones over. See `AiPhoto`.
   */
  image?: Blob;
  /** pending → (analyzing) → done | failed; removed once saved to the diary or discarded. */
  status: 'pending' | 'analyzing' | 'done' | 'failed';
  error?: string;
  result?: AiAnalysisResult;
  /** Review state of a done analysis (rows edited/added by the user), kept across navigation. */
  draft?: AiDraft;
  /**
   * The first analysis had to wait for a connection, or the person left the photo page while it ran
   * (`leaveAnalysis`). Such an item shows as a placeholder row in the diary and is logged by itself
   * once analysed (`logDeferred`), without a review.
   */
  deferred?: boolean;
  /**
   * `aiPhotos` ids that went into the current result. Photos added in the review after it are not in
   * it (marked "Neu" until ↻). Missing on items from older app versions: then all count as analysed.
   */
  analyzedPhotoIds?: number[];
  /**
   * "Eingeben" with a text: the meal was described in `text`, there are no photos (unless
   * some were added in the review later). Analysed with the same call, without images.
   */
  textOnly?: boolean;
  /**
   * Calories and macros the person typed next to the description ("Eingeben"): sent with every
   * analysis of this item as a clue for the amounts. The review shows what the AI found.
   */
  typed?: AiTypedValues;
  /**
   * Idempotency key of the analysis request (uuidv7, not `localId`, which repeats across devices):
   * the server answers a repeated request with the stored result instead of a second paid call. Kept
   * by "Wiederholen" and after a lost connection, new for every ↻.
   */
  requestId?: string;
}

/** One ingredient while reviewing an analysis. `confidence` is null for rows the user added. */
export interface AiDraftRow {
  key: string;
  name: string;
  grams: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
  candidates: Food[];
  foodId: string | null;
  /**
   * Unit chosen in the amount editor (e.g. "1 EL"); null or missing counts grams. `grams` stays the
   * amount either way; logging stores the portion with its count.
   */
  portion?: Portion | null;
}

export interface AiDraft {
  rows: AiDraftRow[];
  meal: number;
  /** Name of the group or meal; prefilled from the analysis, changed in the save dialog. */
  mealName: string;
  /** Set once the review was saved as a meal ("Als Meal speichern"); logging then attaches to it. */
  savedMealId?: string | null;
  /**
   * Row whose food the person is looking up right now ("Selbst suchen"): the food picked in the
   * search replaces this row's food instead of becoming a new row.
   */
  searchRowKey?: string | null;
}

/**
 * Photo of an AI queue item, as bytes in its own table. Two WebKit pitfalls made inline Blobs
 * unreliable: IndexedDB Blobs are file-backed, and a Blob object read earlier becomes unreadable
 * once its record is written again (`WebKitBlobResource error 1`). The queue item is rewritten on
 * every status change and review edit, so the photo lives apart from it, as an ArrayBuffer (always
 * copied on read, never a file reference).
 */
export interface AiImage {
  /** Same key as the queue item. */
  localId: number;
  bytes: ArrayBuffer;
  type: string;
}

/**
 * One photo of an AI queue item (Dexie v5): an analysis takes several (plates, courses, a label).
 * Bytes like `AiImage`, ordered by `id`. Replaces `aiImages`, whose rows `migrateLegacyImages` moves here.
 */
export interface AiPhoto {
  id?: number;
  /** The queue item it belongs to. */
  localId: number;
  bytes: ArrayBuffer;
  type: string;
  createdAt: number;
}

/**
 * One undo step of an assistant turn, serializable (it is kept on the turn, so "Rückgängig" works
 * from the toast and from the history). Runs only through `deleteRecord`, `restoreRecord` and
 * `patchRecord`: `delete` removes records the turn created, `restore` brings back records it deleted,
 * `patch` puts back the field values a record had before.
 */
export type UndoStep =
  | { kind: 'delete'; table: SyncTable; ids: string[] }
  | { kind: 'restore'; table: SyncTable; ids: string[] }
  | { kind: 'patch'; table: SyncTable; id: string; fields: Record<string, unknown> };

/** What one operation did, for the toast and the history. */
export interface AppliedOp {
  kind: AssistantOp['kind'];
  /** "Mittagessen: Magerquark, Banane" */
  text: string;
  /** History detail: "Magerquark, 200 g · Banane, 1 Stück (120 g)". */
  detail?: string;
  kcal?: number;
  /** Some amounts were assumed by the model ("geschätzt"). */
  guessed?: boolean;
  /** Day and meal it wrote to (the next utterance's follow-ups go there). */
  target?: { date: string; meal: number };
  /** New or changed diary entries (the diary scrolls to them). */
  entryIds?: string[];
}

/**
 * One utterance to the assistant on this device (Dexie v6). A recording waits here as bytes until
 * it is sent (offline: `waiting`); afterwards the turn keeps what the server answered and what the
 * device did with it (undo steps, summary). Device only; the server keeps its own log.
 */
export interface AssistantTurn {
  localId?: number;
  /** Idempotency key of the request (uuidv7), also the server's turn id. */
  requestId: string;
  createdAt: number;
  source: 'voice' | 'text';
  /** The recording while it waits (dropped once the server has it). */
  audio?: ArrayBuffer;
  audioType?: string;
  durationMs?: number;
  /** A typed sentence, or the text the recording was edited to. */
  text?: string;
  /** The day the diary showed when the person spoke. */
  shownDate: string;
  status: 'waiting' | 'sending' | 'asking' | 'done' | 'failed' | 'discarded';
  /** Sent later than spoken (it waited for a connection): no open microphone, the camera asks first. */
  late?: boolean;
  /** The turn whose question this utterance answers. */
  answersTo?: number;
  transcript?: string;
  ops?: AssistantOp[];
  question?: AssistantQuestion | null;
  reply?: string | null;
  applied?: AppliedOp[];
  /** Operations whose records this device does not have (left out). */
  skipped?: number;
  undo?: UndoStep[];
  undoneAt?: number;
  error?: string;
}

/** An uploaded figure pack (copy of the account's zip, unpacked). */
export interface AssistantSkin {
  id: string;
  name: string;
  manifest: SkinManifest;
  /** Picture files by name. */
  images: Record<string, { bytes: ArrayBuffer; type: string }>;
  bytes: number;
  createdAt: number;
}

export interface KvItem {
  key: string;
  value: unknown;
}

export class UserDb extends Dexie {
  settings!: EntityTable<Settings, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  customFoods!: EntityTable<CustomFood, 'id'>;
  foodPortions!: EntityTable<FoodPortion, 'id'>;
  meals!: EntityTable<Meal, 'id'>;
  foodEntries!: EntityTable<FoodEntry, 'id'>;
  exerciseTypes!: EntityTable<CustomExerciseType, 'id'>;
  exerciseEntries!: EntityTable<ExerciseEntry, 'id'>;
  exerciseTemplates!: EntityTable<ExerciseTemplate, 'id'>;
  weightEntries!: EntityTable<WeightEntry, 'id'>;
  dayNotes!: EntityTable<DayNote, 'id'>;
  outbox!: EntityTable<OutboxItem, 'key'>;
  foodCache!: EntityTable<CachedFood, 'id'>;
  aiQueue!: EntityTable<AiQueueItem, 'localId'>;
  kv!: EntityTable<KvItem, 'key'>;
  photos!: EntityTable<LocalPhoto, 'id'>;
  aiImages!: EntityTable<AiImage, 'localId'>;
  aiPhotos!: EntityTable<AiPhoto, 'id'>;
  assistantTurns!: EntityTable<AssistantTurn, 'localId'>;
  assistantSkins!: EntityTable<AssistantSkin, 'id'>;

  /**
   * Server clock minus this device's clock (ms), measured by the sync engine. Local versions are
   * stamped with `Date.now() + clockOffset`, so a device whose clock is set wrong neither wins every
   * conflict (ahead) nor loses every one (behind). 0 until the first server answer.
   */
  clockOffset = 0;

  constructor(name: string, options?: ConstructorParameters<typeof Dexie>[1]) {
    super(name, options);
    this.version(1).stores({
      settings: 'id',
      goals: 'id, validFrom',
      customFoods: 'id, barcode',
      foodPortions: 'id, foodId',
      meals: 'id, name',
      foodEntries: 'id, date, [date+meal], foodId, loggedAt',
      exerciseTypes: 'id',
      exerciseEntries: 'id, date',
      weightEntries: 'id, date',
      dayNotes: 'id, date',
      outbox: 'key, table',
      foodCache: 'id, sourceId, lastUsedAt',
      aiQueue: '++localId, createdAt',
      kv: 'key',
    });
    // v2: saved trainings. New fields (exerciseEntries.note, foodEntries.groupId) are not indexed.
    this.version(2).stores({ exerciseTemplates: 'id, name' });
    // v3: meal photos (device copy + upload state). AiQueueItem.draft needs no index.
    this.version(3).stores({ photos: 'id, uploaded' });
    // v4: AI queue photos as bytes in their own table (see `AiImage`). No `.upgrade()`: reading a Blob
    // needs a non-IndexedDB promise, which would end the upgrade transaction; `migrateLegacyImages`
    // moves old queue photos at runtime instead. Meal photos keep their table (`bytes` needs no index).
    this.version(4).stores({ aiImages: 'localId' });
    // v5: several photos per AI queue item. `aiImages` stays declared: its rows are moved over at runtime
    // (`migrateLegacyImages`, same reason as v4 for no `.upgrade()`), then it stays empty.
    this.version(5).stores({ aiPhotos: '++id, localId' });
    // v6: the assistant's utterances (device log, waiting recordings, undo) and uploaded figures.
    this.version(6).stores({ assistantTurns: '++localId, createdAt, status', assistantSkins: 'id' });
  }

  syncTable(name: SyncTable): Table<AnySyncRecord, string> {
    return this.table(name) as unknown as Table<AnySyncRecord, string>;
  }
}

export interface BlsRow {
  id: string;
  row: unknown[];
}

export class CommonDb extends Dexie {
  bls!: EntityTable<BlsRow, 'id'>;
  kv!: EntityTable<KvItem, 'key'>;

  constructor(options?: ConstructorParameters<typeof Dexie>[1]) {
    super('ft-common', options);
    this.version(1).stores({ bls: 'id', kv: 'key' });
  }
}

export const userDbName = (userId: string) => `ft-user-${userId}`;
