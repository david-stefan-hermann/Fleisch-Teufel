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
   * Legacy (app versions before Dexie v4): the photo inline as Blob. New items keep the bytes in
   * `aiImages`; `migrateLegacyImages` moves old ones over. See `AiImage`.
   */
  image?: Blob;
  /** pending → (analyzing) → done | failed; removed once saved to the diary or discarded. */
  status: 'pending' | 'analyzing' | 'done' | 'failed';
  error?: string;
  result?: AiAnalysisResult;
  /** Review state of a done analysis (rows edited/added by the user), kept across navigation. */
  draft?: AiDraft;
}

/** One ingredient while reviewing an analysis. `confidence` is null for rows the user added. */
export interface AiDraftRow {
  key: string;
  name: string;
  grams: number | null;
  confidence: 'low' | 'medium' | 'high' | null;
  candidates: Food[];
  foodId: string | null;
}

export interface AiDraft {
  rows: AiDraftRow[];
  meal: number;
  /** Name of the group or meal; prefilled from the analysis, changed in the save dialog. */
  mealName: string;
  /** Set once the review was saved as a meal ("Als Meal speichern"); logging then attaches to it. */
  savedMealId?: string | null;
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
