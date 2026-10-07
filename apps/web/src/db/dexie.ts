/**
 * Local database (IndexedDB via Dexie). One database per user (`ft-user-<id>`) holds the
 * synced tables (mirror of the Postgres tables), the sync outbox and device-only caches.
 * A shared database (`ft-common`) holds the offline BLS catalog, which is the same for everyone.
 *
 * Keep this file free of `@/` aliases: the API test suite imports it to run real
 * device ↔ server sync tests.
 */
import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  AiAnalysisResult,
  AnySyncRecord,
  CustomExerciseType,
  CustomFood,
  DayNote,
  ExerciseEntry,
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
  image: Blob;
  /** pending → (analyzing) → done | failed; removed once saved to the diary or discarded. */
  status: 'pending' | 'analyzing' | 'done' | 'failed';
  error?: string;
  result?: AiAnalysisResult;
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
  weightEntries!: EntityTable<WeightEntry, 'id'>;
  dayNotes!: EntityTable<DayNote, 'id'>;
  outbox!: EntityTable<OutboxItem, 'key'>;
  foodCache!: EntityTable<CachedFood, 'id'>;
  aiQueue!: EntityTable<AiQueueItem, 'localId'>;
  kv!: EntityTable<KvItem, 'key'>;

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
