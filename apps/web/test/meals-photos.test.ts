import { uuidv7, type AiAnalysisResult, type Food, type MealItem } from '@ft/shared';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addFoodToDraft,
  currentDraft,
  draftChanged,
  draftChoices,
  draftFromResult,
  patchRow,
  rowGrams,
  scaleDraft,
  updateDraft,
} from '@/db/aiDraft';
import { UserDb, type AiDraft } from '@/db/dexie';
import { addItemToMeal, aiMealItems } from '@/db/entries';
import {
  clearMealDraft,
  draftFromMeal,
  isDirty,
  isMealDraftStale,
  readMealDraft,
  readMealDraftPhoto,
  saveMealDraft,
  setMealDraftPhoto,
  writeMealDraft,
} from '@/db/mealDraft';
import {
  countRejectedPhotos,
  loadPhoto,
  PHOTO_REJECTED,
  photoBlob,
  storePhoto,
  uploadPendingPhotos,
} from '@/db/photos';
import {
  discardQueueItem,
  addQueuePhotos,
  enqueueDescription,
  enqueuePhotos,
  leaveAnalysis,
  loadQueueImages,
  loadQueuePhotos,
  migrateLegacyImages,
  processQueue,
  reanalyze,
  removeQueuePhoto,
  restoreQueueItem,
  retryQueueItem,
  takeQueueItem,
} from '@/features/ai/queue';
import { patchRecord, saveRecord } from '@/db/write';
import { parseInto, formatInto, returnFromInto, rememberIntoStart } from '@/lib/into';

const db = () => new UserDb(`t-${uuidv7()}`);

const item = (name: string, kcal: number): MealItem => ({
  foodId: `bls:${name}`,
  source: 'bls',
  name,
  brand: null,
  grams: 100,
  portionLabel: '1 g',
  portionGrams: 1,
  quantity: 100,
  per100: { ENERCC: kcal },
  nutrients: { ENERCC: kcal },
});

const food = (id: string, name: string, kcal: number): Food => ({
  id,
  source: 'bls',
  sourceId: id,
  name,
  nameEn: null,
  brand: null,
  group: null,
  unit: 'g',
  nutrients: { ENERCC: kcal },
  portions: [],
});

describe('saved meal editing (draft until "Speichern")', () => {
  const setup = async () => {
    const d = db();
    await saveRecord(d, 'meals', { id: 'm1', name: 'Müsli', items: [item('Hafer', 370)], photoId: null });
    await d.outbox.clear();
    return d;
  };

  it('starts a draft from the meal and compares it with the saved one', async () => {
    const d = await setup();
    const meal = (await d.meals.get('m1'))!;
    const draft = draftFromMeal(meal);
    expect(draft).toEqual({
      mealId: 'm1',
      name: 'Müsli',
      items: meal.items,
      photo: 'keep',
      baseUpdatedAt: meal.updatedAt,
    });
    expect(isDirty(draft, meal)).toBe(false);
    // An empty or untrimmed name means the same name.
    expect(isDirty({ ...draft, name: '  ' }, meal)).toBe(false);
    expect(isDirty({ ...draft, name: ' Müsli ' }, meal)).toBe(false);
    expect(isDirty({ ...draft, name: 'Porridge' }, meal)).toBe(true);
    expect(isDirty({ ...draft, items: [{ ...meal.items[0]!, quantity: 50 }] }, meal)).toBe(true);
    expect(isDirty({ ...draft, photo: 'remove' }, meal)).toBe(true);
  });

  it('knows when the meal changed under an open draft', async () => {
    const d = db();
    const meal = await saveRecord(d, 'meals', {
      id: uuidv7(),
      name: 'Toast',
      items: [item('Toast', 100)],
      photoId: null,
    });
    const draft = draftFromMeal(meal);
    expect(isMealDraftStale(draft, meal)).toBe(false);
    const renamed = (await patchRecord(d, 'meals', meal.id, { name: 'Toast mit Butter' }))!;
    expect(isMealDraftStale(draft, renamed)).toBe(true);
    // A draft from an older app version (no base) never counts as stale.
    expect(isMealDraftStale({ ...draft, baseUpdatedAt: undefined }, renamed)).toBe(false);
  });

  it('adds an ingredient from the search to the draft, never to the record', async () => {
    const d = await setup();
    expect(await addItemToMeal(d, 'm1', { ...item('Milch', 64), extra: 1 } as MealItem)).toBe(true);
    expect(await addItemToMeal(d, 'missing', item('Milch', 64))).toBe(false);
    const draft = (await readMealDraft(d, 'm1'))!;
    expect(draft.items.map((i) => i.name)).toEqual(['Hafer', 'Milch']);
    // Only item fields go into the draft.
    expect(draft.items[1]).not.toHaveProperty('extra');
    // A second one appends to the existing draft (with its other edits).
    await writeMealDraft(d, { ...draft, name: 'Porridge' });
    await addItemToMeal(d, 'm1', item('Honig', 300));
    expect(await readMealDraft(d, 'm1')).toMatchObject({ name: 'Porridge' });
    expect((await readMealDraft(d, 'm1'))!.items.map((i) => i.name)).toEqual(['Hafer', 'Milch', 'Honig']);
    expect((await d.meals.get('m1'))!.items).toHaveLength(1);
    expect(await d.outbox.count()).toBe(0);
    // A deleted meal takes nothing.
    await saveRecord(d, 'meals', { ...(await d.meals.get('m1'))!, deleted: true });
    expect(await addItemToMeal(d, 'm1', item('Zimt', 250))).toBe(false);
  });

  it('saves name, items and a new photo in one change, storing the photo only now', async () => {
    const d = await setup();
    const draft = draftFromMeal((await d.meals.get('m1'))!);
    await setMealDraftPhoto(d, 'm1', { bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/png', at: 1 });
    await writeMealDraft(d, {
      ...draft,
      name: ' Porridge ',
      items: [...draft.items, item('Milch', 64)],
      photo: 'pending',
    });
    expect(await d.photos.count()).toBe(0);
    expect(await saveMealDraft(d, (await readMealDraft(d, 'm1'))!)).toBe(true);
    const meal = (await d.meals.get('m1'))!;
    expect(meal).toMatchObject({ name: 'Porridge' });
    expect(meal.items.map((i) => i.name)).toEqual(['Hafer', 'Milch']);
    expect(meal.photoId).toBeTruthy();
    expect(await d.photos.get(meal.photoId!)).toMatchObject({ type: 'image/png', uploaded: 0 });
    expect(await d.outbox.get('meals:m1')).toBeTruthy();
    // Both draft keys are gone.
    expect(await readMealDraft(d, 'm1')).toBeNull();
    expect(await readMealDraftPhoto(d, 'm1')).toBeNull();
  });

  it('removes the photo on "remove", refuses an empty meal and reports a missing one', async () => {
    const d = await setup();
    await saveRecord(d, 'meals', { ...(await d.meals.get('m1'))!, photoId: 'p1' });
    const draft = draftFromMeal((await d.meals.get('m1'))!);
    expect(await saveMealDraft(d, { ...draft, photo: 'remove' })).toBe(true);
    expect((await d.meals.get('m1'))!.photoId).toBeNull();
    await expect(saveMealDraft(d, { ...draft, items: [] })).rejects.toThrow();
    expect(await saveMealDraft(d, { ...draft, mealId: 'missing' })).toBe(false);
  });

  it('discards a draft with both keys', async () => {
    const d = await setup();
    await writeMealDraft(d, draftFromMeal((await d.meals.get('m1'))!));
    await setMealDraftPhoto(d, 'm1', { bytes: new ArrayBuffer(1), type: 'image/jpeg', at: 1 });
    await clearMealDraft(d, 'm1');
    expect(await d.kv.count()).toBe(0);
  });
});

describe('AI review draft', () => {
  const result = {
    analysisId: 'a1',
    dishName: null,
    items: [
      {
        name: 'Nudeln',
        grams: 201.4,
        confidence: 'high' as const,
        preparation: null,
        packaged: false,
        searchTerms: [],
        candidates: [{ food: food('bls:N', 'Nudeln gekocht', 150), score: 1 }],
      },
    ],
    notes: null,
    model: 'claude-opus-5-5',
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
  } satisfies AiAnalysisResult;

  it('starts from the analysis and keeps edits and added ingredients', async () => {
    const d = db();
    const localId = (await d.aiQueue.add({
      createdAt: 1,
      date: '2026-10-07',
      meal: 2,
      text: '',
      image: new Blob(['x'], { type: 'image/jpeg' }),
      status: 'done',
      result,
    })) as number;
    const initial = draftFromResult({ meal: 2, result });
    expect(initial).toMatchObject({ meal: 2, mealName: 'Nudeln', rows: [{ grams: 201, foodId: 'bls:N' }] });

    await updateDraft(d, localId, (x) => patchRow(x, initial.rows[0]!.key, { grams: 150 }));
    await addFoodToDraft(d, localId, food('bls:P', 'Parmesan', 390), 12.4);
    const draft = currentDraft((await d.aiQueue.get(localId))!);
    expect(draft.rows.map((r) => [r.name, r.grams, r.confidence])).toEqual([
      ['Nudeln', 150, 'high'],
      ['Parmesan', 12, null],
    ]);
  });

  it('replaces the food of the row a search was opened for and reports it as a choice', async () => {
    const estimated = { ...food('est:a2:1', 'Takoyaki', 175), brand: 'KI-Schätzung', estimated: true };
    const result2 = {
      ...result,
      analysisId: 'a2',
      items: [
        {
          ...result.items[0]!,
          candidates: [
            { food: food('bls:N', 'Nudeln gekocht', 150), score: 2 },
            { food: food('bls:V', 'Vollkornnudeln gekocht', 140), score: 1 },
          ],
        },
        { ...result.items[0]!, name: 'Takoyaki', grams: 180, candidates: [{ food: estimated, score: 0 }] },
        { ...result.items[0]!, name: 'Soße', grams: 30 },
      ],
    } satisfies AiAnalysisResult;
    const d = db();
    const queued = { createdAt: 1, date: '2026-10-07', meal: 2, text: '', status: 'done' as const };
    const localId = (await d.aiQueue.add({ ...queued, result: result2 })) as number;
    const item = { meal: 2, result: result2 };
    // Nothing changed: nothing to learn, and the estimate is logged without a food id.
    const initial = draftFromResult(item);
    expect(draftChoices(item, initial)).toEqual([]);
    expect(
      aiMealItems([
        { food: estimated, grams: 180 },
        { food: food('bls:N', 'Nudeln gekocht', 150), grams: 100 },
      ]),
    ).toMatchObject([
      { foodId: null, source: 'ai', name: 'Takoyaki', brand: 'KI-Schätzung', nutrients: { ENERCC: 315 } },
      { foodId: 'bls:N', source: 'ai' },
    ]);

    // "Selbst suchen" on the estimated row, another candidate for the first, one new ingredient.
    await updateDraft(d, localId, (x) => ({
      ...patchRow(x, 'ai-0', { foodId: 'bls:V' }),
      searchRowKey: 'ai-1',
    }));
    await addFoodToDraft(d, localId, food('off:T', 'Takoyaki TK', 190), 150);
    await addFoodToDraft(d, localId, food('bls:M', 'Mayonnaise', 700), 10);
    const draft = currentDraft((await d.aiQueue.get(localId))!);
    expect(draft.searchRowKey).toBeUndefined();
    expect(
      draft.rows.map((r) => [r.key.slice(0, 4), r.name, r.grams, r.foodId, r.candidates.length]),
    ).toEqual([
      ['ai-0', 'Nudeln', 201, 'bls:V', 2],
      ['ai-1', 'Takoyaki', 150, 'off:T', 2],
      ['ai-2', 'Soße', 30, 'bls:N', 1],
      ['user', 'Mayonnaise', 10, 'bls:M', 1],
    ]);
    // Only rows of the analysis with another food than proposed; the added one has no item name.
    expect(draftChoices(item, draft)).toEqual([
      { name: 'Nudeln', foodId: 'bls:V' },
      { name: 'Takoyaki', foodId: 'off:T' },
    ]);
    // Switching back to the estimate is no choice of a food.
    expect(draftChoices(item, patchRow(draft, 'ai-1', { foodId: 'est:a2:1' }))).toEqual([
      { name: 'Nudeln', foodId: 'bls:V' },
    ]);
  });

  it('scales all ingredients from the reference amounts without drift', () => {
    const draft: AiDraft = {
      ...draftFromResult({ meal: 0, result }),
      rows: [
        { key: 'a', name: 'Nudeln', grams: 200, confidence: 'high', candidates: [], foodId: null },
        { key: 'b', name: 'Soße', grams: 33, confidence: 'low', candidates: [], foodId: null },
        { key: 'c', name: 'Öl', grams: null, confidence: 'low', candidates: [], foodId: null },
      ],
    };
    const base = rowGrams(draft);
    expect(base).toEqual({ a: 200, b: 33, c: null });
    const up = scaleDraft(draft, base, 1.5);
    expect(up.rows.map((r) => r.grams)).toEqual([300, 50, null]);
    // Back and forth always starts from the base: no accumulated rounding.
    let moved = draft;
    for (const f of [1.05, 0.35, 2.95, 0.25, 1]) moved = scaleDraft(moved, base, f);
    expect(moved.rows.map((r) => r.grams)).toEqual([200, 33, null]);
    expect(scaleDraft(draft, base, 0.25).rows.map((r) => r.grams)).toEqual([50, 8, null]);
    // Rows that were added after the base was taken keep their amount.
    const added = { ...draft, rows: [...draft.rows, { ...draft.rows[0]!, key: 'd', grams: 70 }] };
    expect(scaleDraft(added, base, 2).rows.map((r) => r.grams)).toEqual([400, 66, null, 70]);
    expect(up.mealName).toBe(draft.mealName);
  });
});

/**
 * Blob as written by older app versions. fake-indexeddb clones values with Node's structuredClone,
 * which keeps Node Blobs but not jsdom ones, so legacy records are built from Node's Blob.
 */
const legacyBlob = (bytes: number[]) =>
  new NodeBlob([new Uint8Array(bytes)], { type: 'image/jpeg' }) as unknown as Blob;
const isArrayBuffer = (v: unknown) => Object.prototype.toString.call(v) === '[object ArrayBuffer]';
const bytesOf = async (b: Blob | null) => (b ? [...new Uint8Array(await b.arrayBuffer())] : null);

describe('AI queue photos', () => {
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9])], { type: 'image/jpeg' });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the photos as bytes in aiPhotos, apart from the queue item', async () => {
    const d = db();
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: 'halbe Portion' }, [jpeg()]);
    const item = (await d.aiQueue.get(id))!;
    expect(item).toMatchObject({ status: 'pending', text: 'halbe Portion' });
    expect('image' in item).toBe(false);
    const [row] = await d.aiPhotos.where('localId').equals(id).toArray();
    expect(isArrayBuffer(row!.bytes)).toBe(true);
    expect(row!.type).toBe('image/jpeg');
    // Rewriting the queue item (status, review draft) leaves the photo row alone.
    await d.aiQueue.update(id, { status: 'done' });
    const [image] = await loadQueueImages(d, (await d.aiQueue.get(id))!);
    expect(image).toMatchObject({ size: 4, type: 'image/jpeg' });
    expect(await bytesOf(image!)).toEqual([0xff, 0xd8, 0xff, 9]);
  });

  it('keeps several photos in order; photos can be added and removed', async () => {
    const d = db();
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [
      legacyBlob([1]),
      legacyBlob([2]),
    ]);
    await addQueuePhotos(d, id, [legacyBlob([3])]);
    const item = (await d.aiQueue.get(id))!;
    const photos = await loadQueuePhotos(d, item);
    expect(await Promise.all(photos.map((p) => bytesOf(p.blob)))).toEqual([[1], [2], [3]]);
    await removeQueuePhoto(d, photos[1]!.id);
    expect(await Promise.all((await loadQueueImages(d, item)).map(bytesOf))).toEqual([[1], [3]]);
  });

  it('brings back a discarded item with all its photos (undo)', async () => {
    const d = db();
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [
      legacyBlob([1]),
      legacyBlob([2]),
    ]);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const taken = (await takeQueueItem(d, id))!;
    expect(await d.aiQueue.count()).toBe(0);
    expect(await d.aiPhotos.count()).toBe(0);
    await restoreQueueItem(d, taken);
    const item = (await d.aiQueue.get(id))!;
    expect(await Promise.all((await loadQueueImages(d, item)).map(bytesOf))).toEqual([[1], [2]]);
  });

  it('reads the inline photo of items from older app versions', async () => {
    const d = db();
    const localId = (await d.aiQueue.add({
      createdAt: 1,
      date: '2026-10-07',
      meal: 0,
      text: '',
      image: legacyBlob([0xff, 0xd8, 0xff, 9]),
      status: 'done',
    })) as number;
    const [image] = await loadQueueImages(d, (await d.aiQueue.get(localId))!);
    expect(await bytesOf(image!)).toEqual([0xff, 0xd8, 0xff, 9]);
  });

  it('reads and moves the single photo of app version 4 (aiImages)', async () => {
    const d = db();
    const localId = (await d.aiQueue.add({
      createdAt: 1,
      date: '2026-10-07',
      meal: 0,
      text: '',
      status: 'done',
      result: { analysisId: 'a-old' } as AiAnalysisResult,
    })) as number;
    await d.aiImages.put({ localId, bytes: new Uint8Array([5, 6]).buffer, type: 'image/jpeg' });
    // Readable before the migration ran (the diary may render first).
    expect((await loadQueuePhotos(d, (await d.aiQueue.get(localId))!)).map((p) => p.id)).toEqual([0]);
    await migrateLegacyImages(d);
    expect(await d.aiImages.count()).toBe(0);
    const item = (await d.aiQueue.get(localId))!;
    const photos = await loadQueuePhotos(d, item);
    expect(await bytesOf(photos[0]!.blob)).toEqual([5, 6]);
    // A finished analysis counts its moved photo as analysed.
    expect(item.analyzedPhotoIds).toEqual([photos[0]!.id]);
  });

  it('discards the item and its photo together', async () => {
    const d = db();
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg()]);
    await discardQueueItem(d, id);
    expect(await d.aiQueue.count()).toBe(0);
    expect(await d.aiPhotos.count()).toBe(0);
  });

  it('migrates inline photos once and removes orphaned ones', async () => {
    const d = db();
    const legacy = (await d.aiQueue.add({
      createdAt: 1,
      date: '2026-10-07',
      meal: 0,
      text: '',
      image: legacyBlob([0xff, 0xd8, 0xff, 9]),
      status: 'done',
    })) as number;
    await d.aiImages.put({ localId: 999, bytes: new ArrayBuffer(1), type: 'image/jpeg' });
    await d.aiPhotos.add({ localId: 998, bytes: new ArrayBuffer(1), type: 'image/jpeg', createdAt: 1 });
    await migrateLegacyImages(d);
    const item = (await d.aiQueue.get(legacy))!;
    expect('image' in item).toBe(false);
    expect(item.status).toBe('done');
    const [image] = await loadQueueImages(d, item);
    expect(await bytesOf(image!)).toEqual([0xff, 0xd8, 0xff, 9]);
    expect(await d.aiImages.count()).toBe(0);
    // Idempotent; the orphans are gone.
    await migrateLegacyImages(d);
    expect(await d.aiPhotos.count()).toBe(1);
  });

  it('fails an unanalyzed item whose photo is gone instead of retrying forever', async () => {
    const d = db();
    const id = (await d.aiQueue.add({
      createdAt: 1,
      date: '2026-10-07',
      meal: 0,
      text: '',
      status: 'pending',
    })) as number;
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    await processQueue(d);
    expect(await d.aiQueue.get(id)).toMatchObject({ status: 'failed', error: 'Foto nicht mehr vorhanden' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('AI review: re-analyze with the hint', () => {
  const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 9])], { type: 'image/jpeg' });
  afterEach(() => vi.unstubAllGlobals());
  const analysis = (name: string, grams: number) =>
    ({
      analysisId: `a-${name}`,
      dishName: name,
      items: [
        {
          name,
          grams,
          confidence: 'high' as const,
          preparation: null,
          packaged: false,
          searchTerms: [],
          candidates: [{ food: food(`bls:${name}`, name, 150), score: 1 }],
        },
      ],
      notes: null,
      model: 'claude-opus-5-5',
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    }) satisfies AiAnalysisResult;
  /** Answers each analyze call with the next result; records the hints sent. */
  const server = (...answers: (AiAnalysisResult | Response)[]) => {
    const hints: string[] = [];
    const images: number[] = [];
    const fetchFn = vi.fn(async (_path: string, init?: RequestInit) => {
      hints.push(String((init?.body as FormData).get('text') ?? ''));
      images.push((init?.body as FormData).getAll('image').length);
      const next = answers.shift()!;
      return next instanceof Response ? next : new Response(JSON.stringify(next), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchFn);
    return { fetchFn, hints, images };
  };
  async function analyzed(d: UserDb) {
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: 'mit Butter' }, [jpeg()]);
    await processQueue(d);
    return id;
  }

  it('notices changed ingredients only (amount, food, rows), not meal or name', () => {
    const it0 = { meal: 1, result: analysis('Nudeln', 200) };
    const base = draftFromResult(it0);
    expect(draftChanged({ ...it0, draft: undefined })).toBe(false);
    expect(draftChanged({ ...it0, draft: { ...base, meal: 3, mealName: 'Anders' } })).toBe(false);
    expect(draftChanged({ ...it0, draft: patchRow(base, 'ai-0', { grams: 180 }) })).toBe(true);
    expect(draftChanged({ ...it0, draft: patchRow(base, 'ai-0', { foodId: 'x' }) })).toBe(true);
    expect(draftChanged({ ...it0, draft: { ...base, rows: [] } })).toBe(true);
  });

  it('sends the photo again with the new hint and replaces the review rows', async () => {
    const d = db();
    const { fetchFn, hints } = server(analysis('Nudeln', 200), analysis('Reis', 150));
    const id = await analyzed(d);
    await d.aiQueue.update(id, {
      draft: { ...patchRow(draftFromResult((await d.aiQueue.get(id))!), 'ai-0', { grams: 90 }), meal: 2 },
    });
    expect(await reanalyze(d, id, '  ohne Butter ')).toBe('done');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(hints).toEqual(['mit Butter', 'ohne Butter']);
    const item = (await d.aiQueue.get(id))!;
    expect(item.text).toBe('ohne Butter');
    expect(item.result!.dishName).toBe('Reis');
    // New rows from the new result; the chosen meal stays.
    expect(currentDraft(item).rows.map((r) => [r.name, r.grams])).toEqual([['Reis', 150]]);
    expect(currentDraft(item).meal).toBe(2);
    // Only one queue item: the analysis is replaced, not duplicated.
    expect(await d.aiQueue.count()).toBe(1);
  });

  it('sends all photos, also ones added in the review, and records which went into the result', async () => {
    const d = db();
    const { images } = server(analysis('Schnitzel', 200), analysis('Schnitzel mit Tiramisu', 300));
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg(), jpeg()]);
    await processQueue(d);
    const first = (await d.aiQueue.get(id))!;
    const ids = (await loadQueuePhotos(d, first)).map((p) => p.id);
    expect(first.analyzedPhotoIds).toEqual(ids);
    await addQueuePhotos(d, id, [jpeg()]);
    // Added: not analysed until ↻.
    const now = (await loadQueuePhotos(d, first)).map((p) => p.id);
    expect(now.filter((p) => !first.analyzedPhotoIds!.includes(p))).toHaveLength(1);
    expect(await reanalyze(d, id, '')).toBe('done');
    expect(images).toEqual([2, 3]);
    expect((await d.aiQueue.get(id))!.analyzedPhotoIds).toEqual(now);
  });

  it('logs an analysis the person left by itself, once, with all photos', async () => {
    const d = db();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await held;
        return new Response(JSON.stringify(analysis('Nudeln', 250)), { status: 200 });
      }),
    );
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg(), jpeg()]);
    const running = processQueue(d);
    await vi.waitFor(async () => expect((await d.aiQueue.get(id))!.status).toBe('analyzing'));
    // Back to the diary while it runs; twice, as an unmount cleanup and the back button may both call it.
    await leaveAnalysis(d, id);
    await leaveAnalysis(d, id);
    release();
    await running;
    await processQueue(d);
    expect(await d.aiQueue.count()).toBe(0);
    const entries = await d.foodEntries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.photoIds).toHaveLength(2);
    expect(await d.photos.count()).toBe(2);
  });

  it('logs a first analysis the app was closed during by itself', async () => {
    const d = db();
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg()]);
    // As left behind by a closed app: still "analyzing", no result.
    await d.aiQueue.update(id, { status: 'analyzing' });
    server(analysis('Nudeln', 250));
    await processQueue(d);
    expect(await d.aiQueue.count()).toBe(0);
    expect(await d.foodEntries.count()).toBe(1);
  });

  it('logs an analysis left right after it finished', async () => {
    const d = db();
    server(analysis('Nudeln', 250));
    const id = await analyzed(d);
    expect((await d.aiQueue.get(id))!.status).toBe('done');
    await leaveAnalysis(d, id);
    await processQueue(d);
    expect(await d.aiQueue.count()).toBe(0);
    expect(await d.foodEntries.count()).toBe(1);
  });

  it('keeps a review saved as a meal linked to it (with its name)', async () => {
    const d = db();
    server(analysis('Nudeln', 200), analysis('Reis', 150));
    const id = await analyzed(d);
    const draft = draftFromResult((await d.aiQueue.get(id))!);
    await d.aiQueue.update(id, { draft: { ...draft, savedMealId: 'meal-1', mealName: 'Mein Teller' } });
    await reanalyze(d, id, 'mit Reis');
    const now = currentDraft((await d.aiQueue.get(id))!);
    expect(now).toMatchObject({ savedMealId: 'meal-1', mealName: 'Mein Teller' });
    expect(now.rows[0]!.name).toBe('Reis');
  });

  it('runs once for a double tap and keeps result and rows when it fails', async () => {
    const d = db();
    const { fetchFn } = server(
      analysis('Nudeln', 200),
      new Response(JSON.stringify({ error: 'no_result' }), { status: 502 }),
    );
    const id = await analyzed(d);
    const edited = patchRow(draftFromResult((await d.aiQueue.get(id))!), 'ai-0', { grams: 90 });
    await d.aiQueue.update(id, { draft: edited });
    const [first, second] = await Promise.all([reanalyze(d, id, 'x'), reanalyze(d, id, 'y')]);
    expect([first, second].sort()).toEqual(['busy', 'failed']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const item = (await d.aiQueue.get(id))!;
    expect(item.status).toBe('failed');
    expect(item.result!.dishName).toBe('Nudeln');
    expect(item.draft).toEqual(edited);
    // The review stays editable after a failure (updateDraft needs a result, not 'done').
    await addFoodToDraft(d, id, food('bls:R', 'Reis', 130), 100);
    expect(currentDraft((await d.aiQueue.get(id))!).rows).toHaveLength(2);
  });

  it('waits offline and reports it', async () => {
    const d = db();
    server(analysis('Nudeln', 200));
    const id = await analyzed(d);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await reanalyze(d, id, 'x')).toBe('pending');
    expect(await reanalyze(d, id, 'y')).toBe('busy');
    expect((await d.aiQueue.get(id))!.result!.dishName).toBe('Nudeln');
    // A re-analysis that waits keeps its review; only a first analysis is logged by itself.
    expect((await d.aiQueue.get(id))!.deferred).toBeUndefined();
  });

  it('logs a photo taken offline by itself once it is analysed', async () => {
    const d = db();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg()]);
    await processQueue(d);
    // Waiting: still in the queue (the diary shows it as a placeholder), nothing logged.
    expect(await d.aiQueue.get(id)).toMatchObject({ status: 'pending', deferred: true });
    expect(await d.foodEntries.count()).toBe(0);

    server(analysis('Nudeln', 250));
    await processQueue(d);
    expect(await d.aiQueue.count()).toBe(0);
    expect(await d.aiPhotos.count()).toBe(0);
    const entries = await d.foodEntries.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      date: '2026-10-07',
      meal: 1,
      source: 'ai',
      name: 'Nudeln',
      grams: 250,
      groupName: 'Nudeln',
      aiAnalysisId: 'a-Nudeln',
    });
    // The analysed photo went along as the photo of the group.
    expect(entries[0]!.photoId).toBeTruthy();
    expect(await d.photos.count()).toBe(1);
  });

  it('keeps an offline photo without any usable item as a normal review', async () => {
    const d = db();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg()]);
    await processQueue(d);
    server({ ...analysis('Nudeln', 250), items: [] });
    await processQueue(d);
    expect(await d.aiQueue.get(id)).toMatchObject({ status: 'done', deferred: false });
    expect(await d.foodEntries.count()).toBe(0);
  });

  it('does not log an analysis that ran right away', async () => {
    const d = db();
    server(analysis('Nudeln', 250));
    const id = await analyzed(d);
    expect((await d.aiQueue.get(id))!.status).toBe('done');
    expect(await d.foodEntries.count()).toBe(0);
  });

  it('logs a first analysis by itself after "Wiederholen" from the diary', async () => {
    const d = db();
    // The first try fails while the person waits on the photo page (no `deferred`).
    server(new Response(JSON.stringify({ error: 'no_result' }), { status: 502 }));
    const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg()]);
    await processQueue(d);
    expect(await d.aiQueue.get(id)).toMatchObject({ status: 'failed' });
    expect((await d.aiQueue.get(id))!.deferred).toBeUndefined();
    // Later, from the diary row: nobody waits on the page any more, so the result goes to the diary.
    server(analysis('Nudeln', 250));
    await retryQueueItem(d, id);
    await processQueue(d);
    expect(await d.aiQueue.count()).toBe(0);
    expect(await d.foodEntries.count()).toBe(1);
  });

  it('keeps the review of a failed re-analysis on "Wiederholen" (no deferred logging)', async () => {
    const d = db();
    server(analysis('Nudeln', 200), new Response(JSON.stringify({ error: 'no_result' }), { status: 502 }));
    const id = await analyzed(d);
    expect(await reanalyze(d, id, 'x')).toBe('failed');
    server(analysis('Nudeln', 300));
    await retryQueueItem(d, id);
    await processQueue(d);
    expect(await d.aiQueue.get(id)).toMatchObject({ status: 'done' });
    expect((await d.aiQueue.get(id))!.deferred).toBeUndefined();
    expect(await d.foodEntries.count()).toBe(0);
  });

  it('marks an analysis whose logging fails and goes on with the next one', async () => {
    const d = db();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    const bad = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg()]);
    const good = await enqueuePhotos(d, { date: '2026-10-07', meal: 2, text: '' }, [jpeg()]);
    await processQueue(d);
    // The run stops at the first offline item; the second was left on the photo page (`leaveAnalysis`).
    await d.aiQueue.update(good, { deferred: true });
    // The first result is one the diary cannot store (an invalid record), the second is fine.
    server(
      { ...analysis('Kaputt', 1), items: [{ ...analysis('Kaputt', 1).items[0]!, grams: 1e9 }] },
      analysis('Nudeln', 250),
    );
    await processQueue(d);
    const failed = (await d.aiQueue.get(bad))!;
    expect(failed.status).toBe('failed');
    expect(failed.deferred).toBe(true);
    expect(failed.result).toBeTruthy();
    // The second photo was still analysed and logged.
    expect(await d.aiQueue.get(good)).toBeUndefined();
    expect(await d.foodEntries.count()).toBe(1);
    // "Wiederholen" of the failed logging logs again instead of paying for a new analysis.
    const { fetchFn } = server(analysis('Nie', 1));
    await d.aiQueue.update(bad, { result: analysis('Kaputt', 100) });
    await retryQueueItem(d, bad);
    await processQueue(d);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await d.aiQueue.get(bad)).toBeUndefined();
    expect(await d.foodEntries.count()).toBe(2);
  });

  it('analyses a described meal without photos and logs it when the person left', async () => {
    const d = db();
    const { images, hints } = server(analysis('Doener', 350));
    const id = await enqueueDescription(d, { date: '2026-10-07', meal: 1, text: ' Döner mit allem ' });
    expect(await d.aiQueue.get(id)).toMatchObject({
      textOnly: true,
      text: 'Döner mit allem',
      status: 'pending',
    });
    await processQueue(d);
    // No image field, the description as text; the review waits for the person like a photo result.
    expect(images).toEqual([0]);
    expect(hints).toEqual(['Döner mit allem']);
    expect(await d.aiQueue.get(id)).toMatchObject({ status: 'done', analyzedPhotoIds: [] });
    expect(await d.foodEntries.count()).toBe(0);
    await leaveAnalysis(d, id);
    await processQueue(d);
    expect(await d.aiQueue.count()).toBe(0);
    const logged = await d.foodEntries.toArray();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      name: 'Doener',
      grams: 350,
      groupName: 'Doener',
      photoId: null,
      photoIds: null,
    });
  });

  it('treats a timeout as a failure to repeat by hand, not as offline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const d = db();
      vi.stubGlobal(
        'fetch',
        vi.fn((_: string, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
          });
        }),
      );
      const id = await enqueuePhotos(d, { date: '2026-10-07', meal: 1, text: '' }, [jpeg()]);
      const run = processQueue(d);
      await vi.waitFor(async () => expect((await d.aiQueue.get(id))!.status).toBe('analyzing'));
      await vi.advanceTimersByTimeAsync(120_001);
      await run;
      const item = (await d.aiQueue.get(id))!;
      expect(item.status).toBe('failed');
      expect(item.error).toMatch(/zu lange/);
      expect(item.deferred).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('photos', () => {
  const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });

  it('stores photos as bytes and reads legacy Blob records', async () => {
    const d = db();
    const id = await storePhoto(d, blob());
    const p = (await d.photos.get(id))!;
    expect(isArrayBuffer(p.bytes)).toBe(true);
    expect(p).toMatchObject({ type: 'image/jpeg', uploaded: 0 });
    expect(p.blob).toBeUndefined();
    expect(await bytesOf(photoBlob(p))).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    // Records written by older app versions hold a Blob.
    await d.photos.put({
      id: 'old',
      blob: legacyBlob([0xff, 0xd8, 0xff, 1, 2, 3]),
      uploaded: 1,
      createdAt: 1,
    });
    expect(await bytesOf(await loadPhoto(d, 'old', async () => new Response(null, { status: 500 })))).toEqual(
      [0xff, 0xd8, 0xff, 1, 2, 3],
    );
    // Uploads send the bytes with their type.
    let sent: { type: string | null; body: unknown } | null = null;
    await uploadPendingPhotos(d, async (_path, init) => {
      sent = { type: new Headers(init?.headers).get('content-type'), body: init?.body };
      return new Response(null, { status: 200 });
    });
    expect(sent!.type).toBe('image/jpeg');
    expect(isArrayBuffer(sent!.body)).toBe(true);
  });

  it('uploads pending photos once and survives permanent server refusals', async () => {
    const d = db();
    const a = await storePhoto(d, blob());
    const b = await storePhoto(d, blob());
    const calls: string[] = [];
    const fetchFn = async (path: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${path}`);
      return new Response(null, { status: path.endsWith(b) ? 415 : 200 });
    };
    expect(await uploadPendingPhotos(d, fetchFn)).toEqual({ uploaded: 1, error: null });
    expect(await uploadPendingPhotos(d, fetchFn)).toEqual({ uploaded: 0, error: null });
    expect(calls).toHaveLength(2);
    expect((await d.photos.get(a))!.uploaded).toBe(1);
    expect((await d.photos.get(b))!.uploaded).toBe(PHOTO_REJECTED);
    expect(await countRejectedPhotos(d)).toBe(1);
  });

  it('keeps photos queued while offline and reports the first failure after trying all', async () => {
    const d = db();
    const a = await storePhoto(d, blob());
    const b = await storePhoto(d, blob());
    const c = await storePhoto(d, blob());
    const result = await uploadPendingPhotos(d, async (path) => {
      if (path.endsWith(a)) throw new TypeError('Failed to fetch');
      if (path.endsWith(b)) return new Response(null, { status: 429 });
      return new Response(null, { status: 200 });
    });
    expect(result.uploaded).toBe(1);
    expect(result.error).toBeInstanceOf(TypeError);
    expect((await d.photos.get(a))!.uploaded).toBe(0);
    expect((await d.photos.get(b))!.uploaded).toBe(0);
    expect((await d.photos.get(c))!.uploaded).toBe(1);
  });

  it('downloads a photo from another device once and caches it', async () => {
    const d = db();
    let gets = 0;
    const fetchFn = async () => {
      gets++;
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    };
    // (jsdom and Node have different Blob classes, so compare the content instead of instanceof)
    expect(await loadPhoto(d, 'remote-1', fetchFn)).toMatchObject({ size: 4, type: 'image/jpeg' });
    expect(await loadPhoto(d, 'remote-1', fetchFn)).toMatchObject({ size: 4 });
    expect(gets).toBe(1);
    expect(isArrayBuffer((await d.photos.get('remote-1'))!.bytes)).toBe(true);
    expect(await loadPhoto(d, 'gone', async () => new Response(null, { status: 404 }))).toBeNull();
  });
});

describe('into parameter', () => {
  it('parses only well-formed targets', () => {
    expect(parseInto('meal:abc-123')).toEqual({ kind: 'meal', mealId: 'abc-123' });
    expect(parseInto('ai:7')).toEqual({ kind: 'ai', localId: 7 });
    expect(parseInto('ai:x')).toBeNull();
    expect(parseInto('meal:<script>')).toBeNull();
    expect(formatInto({ kind: 'ai', localId: 3 })).toBe('ai:3');
    // A diary group being edited (its day travels in the `date` search param).
    expect(parseInto('group:0199c3a0-7f1e-7abc-8def-0123456789ab')).toEqual({
      kind: 'group',
      groupId: '0199c3a0-7f1e-7abc-8def-0123456789ab',
    });
    expect(parseInto('group:')).toBeNull();
    expect(formatInto({ kind: 'group', groupId: 'g1' })).toBe('group:g1');
  });

  it('returns to the screen that opened the search', () => {
    const moves: number[] = [];
    const history = { location: { state: { __TSR_index: 4 } }, go: (n: number) => moves.push(n) };
    rememberIntoStart(history);
    history.location.state.__TSR_index = 7;
    let fallback = 0;
    returnFromInto(history, () => fallback++);
    expect(moves).toEqual([-3]);
    returnFromInto(history, () => fallback++);
    expect(fallback).toBe(1);
  });
});
