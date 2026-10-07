import { uuidv7, type AiAnalysisResult, type Food, type MealItem } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { addFoodToDraft, currentDraft, draftFromResult, patchRow, updateDraft } from '@/db/aiDraft';
import { UserDb } from '@/db/dexie';
import { addItemToMeal, updateMealItem } from '@/db/entries';
import { loadPhoto, storePhoto, uploadPendingPhotos } from '@/db/photos';
import { saveRecord } from '@/db/write';
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

describe('saved meal editing', () => {
  it('adds, rescales and removes ingredients but never the last one', async () => {
    const d = db();
    await saveRecord(d, 'meals', { id: 'm1', name: 'Müsli', items: [item('Hafer', 370)], photoId: null });
    expect(await addItemToMeal(d, 'm1', item('Milch', 64))).toBe(true);
    expect(await addItemToMeal(d, 'missing', item('Milch', 64))).toBe(false);
    let meal = (await d.meals.get('m1'))!;
    expect(meal.items.map((i) => i.name)).toEqual(['Hafer', 'Milch']);

    await updateMealItem(d, 'm1', 1, {
      ...meal.items[1]!,
      quantity: 200,
      grams: 200,
      nutrients: { ENERCC: 128 },
    });
    meal = (await d.meals.get('m1'))!;
    expect(meal.items[1]).toMatchObject({ quantity: 200, nutrients: { ENERCC: 128 } });

    await updateMealItem(d, 'm1', 0, null);
    expect((await d.meals.get('m1'))!.items.map((i) => i.name)).toEqual(['Milch']);
    await expect(updateMealItem(d, 'm1', 0, null)).rejects.toThrow();
    expect(await d.outbox.get('meals:m1')).toBeTruthy();
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
});

describe('photos', () => {
  const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type: 'image/jpeg' });

  it('uploads pending photos once and survives permanent server refusals', async () => {
    const d = db();
    const a = await storePhoto(d, blob());
    const b = await storePhoto(d, blob());
    const calls: string[] = [];
    const fetchFn = async (path: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${path}`);
      return new Response(null, { status: path.endsWith(b) ? 415 : 200 });
    };
    expect(await uploadPendingPhotos(d, fetchFn)).toBe(1);
    expect(await uploadPendingPhotos(d, fetchFn)).toBe(0);
    expect(calls).toHaveLength(2);
    expect((await d.photos.get(a))!.uploaded).toBe(1);
  });

  it('keeps photos queued while offline', async () => {
    const d = db();
    const id = await storePhoto(d, blob());
    await expect(
      uploadPendingPhotos(d, async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).rejects.toThrow();
    expect((await d.photos.get(id))!.uploaded).toBe(0);
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
