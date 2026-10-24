import {
  dayId,
  groupDiaryEntries,
  rescaleItem,
  uuidv7,
  type AiAnalysisResult,
  type Food,
  type MealItem,
} from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import {
  createAiMeal,
  entriesToMealItems,
  logAiItems,
  logAiMeal,
  logFoodEntry,
  logItems,
  moveEntriesToMeal,
  saveExercise,
  saveExerciseTemplate,
  saveMealFromEntries,
  saveMealFromItems,
} from '@/db/entries';
import {
  addGroupDraftPhotos,
  addItemToGroupDraft,
  clearGroupDraft,
  draftFromEntries,
  groupDraftFromAnalysis,
  groupEntries,
  groupName,
  groupVersion,
  isGroupDirty,
  isGroupDraftStale,
  readGroupDraft,
  readGroupDraftPhotos,
  removeGroupDraftPhoto,
  saveGroupDraft,
  writeGroupDraft,
} from '@/db/groupDraft';
import {
  clearClipboard,
  clipboardKcal,
  copyToClipboard,
  pasteClipboard,
  readClipboard,
} from '@/db/clipboard';
import { trashCount, trashedMeals, trashedTrainings, trashedWeights } from '@/db/trash';
import { createBackup, parseBackup, restoreBackup } from '@/db/backup';
import { saveDayNote } from '@/db/notes';
import { DEFAULT_SETTINGS, saveSettings } from '@/db/settings';
import { deleteRecord, patchRecord, restoreRecord, saveRecord } from '@/db/write';
import { saveOnboarding } from '@/features/goals/saveOnboarding';

const db = () => new UserDb(`t-${uuidv7()}`);

describe('local writes', () => {
  it('versions records and queues them in the outbox atomically', async () => {
    const d = db();
    const w = await saveRecord(d, 'weightEntries', {
      id: dayId.weight('2026-10-07'),
      date: '2026-10-07',
      kg: 80,
    });
    expect(w.deleted).toBe(false);
    expect(await d.outbox.get('weightEntries:w:2026-10-07')).toMatchObject({ updatedAt: w.updatedAt });
    const w2 = await patchRecord(d, 'weightEntries', w.id, { kg: 79.5 });
    expect(w2!.updatedAt).toBeGreaterThan(w.updatedAt);
    expect(await d.outbox.count()).toBe(1);
  });

  it('patches read the current version inside the transaction (no lost update)', async () => {
    const d = db();
    const id = uuidv7();
    await saveRecord(d, 'customFoods', {
      id,
      name: 'Alt',
      brand: null,
      barcode: null,
      unit: 'g',
      nutrients: {},
      portions: [],
    });
    // Two patches at once (e.g. a rename and a pull applying another device's barcode).
    await Promise.all([
      patchRecord(d, 'customFoods', id, { name: 'Neu' }),
      patchRecord(d, 'customFoods', id, { barcode: '4000417025005' }),
    ]);
    expect(await d.customFoods.get(id)).toMatchObject({ name: 'Neu', barcode: '4000417025005' });
  });

  it('soft-deletes and restores', async () => {
    const d = db();
    const w = await saveRecord(d, 'weightEntries', {
      id: dayId.weight('2026-10-08'),
      date: '2026-10-08',
      kg: 80,
    });
    await deleteRecord(d, 'weightEntries', w.id);
    expect((await d.weightEntries.get(w.id))!.deleted).toBe(true);
    await restoreRecord(d, 'weightEntries', w.id);
    expect((await d.weightEntries.get(w.id))!.deleted).toBe(false);
  });

  it('lists deleted weights, meals and saved trainings in the trash, newest deletion first', async () => {
    const d = db();
    const item = {
      foodId: null,
      source: 'quick' as const,
      name: 'Toast',
      brand: null,
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: { ENERCC: 100 },
    };
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03'])
      await saveRecord(d, 'weightEntries', { id: dayId.weight(date), date, kg: 80 });
    const meal = await saveRecord(d, 'meals', {
      id: uuidv7(),
      name: 'Toast',
      items: [item],
      photoId: null,
      cookedGrams: null,
    });
    const training = (name: string) => ({
      name,
      typeKey: 'running',
      typeName: 'Laufen',
      minutes: 30,
      intensity: 'moderate' as const,
      note: null,
    });
    const t1 = await saveExerciseTemplate(d, training('Bahntraining'));
    const t2 = await saveExerciseTemplate(d, training('Dauerlauf'));
    expect(await trashCount(d)).toBe(0);
    await deleteRecord(d, 'exerciseTemplates', t2);
    // Two deletions in the same millisecond would tie on updatedAt.
    await new Promise((r) => setTimeout(r, 3));
    await deleteRecord(d, 'exerciseTemplates', t1);
    expect((await trashedTrainings(d)).map((t) => t.name)).toEqual(['Bahntraining', 'Dauerlauf']);
    expect(await trashCount(d)).toBe(2);
    await restoreRecord(d, 'exerciseTemplates', t1);
    await restoreRecord(d, 'exerciseTemplates', t2);
    expect(await trashedTrainings(d)).toEqual([]);
    await deleteRecord(d, 'weightEntries', dayId.weight('2026-10-02'));
    await new Promise((r) => setTimeout(r, 3));
    await deleteRecord(d, 'weightEntries', dayId.weight('2026-10-01'));
    await deleteRecord(d, 'meals', meal.id);
    expect((await trashedWeights(d)).map((w) => w.date)).toEqual(['2026-10-01', '2026-10-02']);
    expect((await trashedMeals(d)).map((m) => m.name)).toEqual(['Toast']);
    expect(await trashCount(d)).toBe(3);
    // A new weight on the same day reuses the deterministic id and leaves the trash.
    await saveRecord(d, 'weightEntries', { id: dayId.weight('2026-10-02'), date: '2026-10-02', kg: 79 });
    await restoreRecord(d, 'meals', meal.id);
    expect((await trashedWeights(d)).map((w) => w.date)).toEqual(['2026-10-01']);
    expect(await trashedMeals(d)).toEqual([]);
    expect(await trashCount(d)).toBe(1);
  });

  it('rejects invalid records without touching the outbox', async () => {
    const d = db();
    await expect(
      saveRecord(d, 'weightEntries', { id: 'w:2026-10-09', date: '2026-10-09', kg: 5 }),
    ).rejects.toThrow();
    expect(await d.outbox.count()).toBe(0);
  });

  it('logs one food on one day', async () => {
    const d = db();
    await logFoodEntry(
      d,
      {
        meal: 0,
        foodId: 'bls:C133000',
        source: 'bls',
        name: 'Hafer',
        brand: null,
        grams: 50,
        portionLabel: '100 g',
        portionGrams: 100,
        quantity: 0.5,
        per100: { ENERCC: 348 },
        nutrients: { ENERCC: 174 },
        mealId: null,
        aiAnalysisId: null,
      },
      '2026-10-09',
    );
    const all = await d.foodEntries.toArray();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ date: '2026-10-09', groupId: null, groupName: null, photoId: null });
    expect(await d.outbox.count()).toBe(1);
  });

  it('saves an AI analysis as a meal with photo without logging, then logs it attached to the meal', async () => {
    const d = db();
    const food = {
      id: 'bls:X',
      source: 'bls' as const,
      sourceId: 'X',
      name: 'Pommes',
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g' as const,
      nutrients: { ENERCC: 240, FAT: 12 },
      portions: [],
    };
    const ketchup = { ...food, id: 'bls:K', sourceId: 'K', name: 'Ketchup', nutrients: { ENERCC: 100 } };
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const mealId = await createAiMeal(
      d,
      '  Pommes mit Ketchup ',
      [
        { food, grams: 150 },
        { food: ketchup, grams: 20 },
      ],
      photo,
    );
    const meal = await d.meals.get(mealId);
    expect(meal).toMatchObject({ name: 'Pommes mit Ketchup', deleted: false });
    expect(meal!.photoId).toBeTruthy();
    expect(await d.photos.get(meal!.photoId!)).toMatchObject({ type: 'image/jpeg' });
    expect(meal!.items.map((i) => i.name)).toEqual(['Pommes', 'Ketchup']);
    // Saving logs nothing.
    expect(await d.foodEntries.count()).toBe(0);

    // Logging later: the meal takes over the reviewed ingredients and name.
    const n = await logAiMeal(
      d,
      mealId,
      'Pommes rot-weiß',
      [{ food, grams: 200 }],
      { date: '2026-10-07', meal: 2 },
      { analysisId: 'a1' },
    );
    expect(n).toBe(1);
    const updated = await d.meals.get(mealId);
    expect(updated).toMatchObject({ name: 'Pommes rot-weiß', photoId: meal!.photoId });
    expect(updated!.items.map((i) => [i.name, i.grams])).toEqual([['Pommes', 200]]);
    const entries = await d.foodEntries.orderBy('loggedAt').toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: 'ai',
      grams: 200,
      quantity: 200,
      portionGrams: 1,
      aiAnalysisId: 'a1',
      mealId,
      meal: 2,
      nutrients: { ENERCC: 480, FAT: 24 },
    });
    expect(entries[0]!.groupId).toBeTruthy();
    // The name comes from the saved meal.
    expect(entries[0]!.groupName).toBeNull();
    // Without analysed photos the entry keeps the meal's photo of this moment.
    expect(entries[0]!.photoId).toBe(meal!.photoId);
    expect(entries[0]!.photoIds).toEqual([meal!.photoId]);

    // With the analysed photos the entries carry all of them (the meal keeps its one photo).
    const side = new Blob([new Uint8Array([6])], { type: 'image/jpeg' });
    await logAiMeal(
      d,
      mealId,
      'Pommes rot-weiß',
      [{ food, grams: 200 }],
      { date: '2026-10-08', meal: 2 },
      {
        analysisId: 'a5',
      },
      [photo, side],
    );
    const [later] = await d.foodEntries.where('date').equals('2026-10-08').toArray();
    expect(later!.photoIds).toHaveLength(2);
    expect(later!.photoId).toBe(later!.photoIds![0]);
    expect((await d.meals.get(mealId))!.photoId).toBe(meal!.photoId);
  });

  it('brings back a saved AI meal that was deleted before logging', async () => {
    const d = db();
    const food = {
      id: 'bls:S',
      source: 'bls' as const,
      sourceId: 'S',
      name: 'Salat',
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g' as const,
      nutrients: { ENERCC: 20 },
      portions: [],
    };
    const mealId = await createAiMeal(d, 'Salat', [{ food, grams: 100 }]);
    await deleteRecord(d, 'meals', mealId);
    await logAiMeal(
      d,
      mealId,
      'Salat',
      [{ food, grams: 100 }],
      { date: '2026-10-07', meal: 1 },
      { analysisId: 'a3' },
    );
    expect((await d.meals.get(mealId))!.deleted).toBe(false);
    expect(await d.foodEntries.count()).toBe(1);
  });

  it('saves the entries of a diary meal as a reusable meal (item fields only)', async () => {
    const d = db();
    await logItems(
      d,
      [
        {
          foodId: null,
          source: 'quick',
          name: 'Joghurt',
          brand: null,
          grams: null,
          portionLabel: null,
          portionGrams: null,
          quantity: 1,
          per100: null,
          nutrients: { ENERCC: 150 },
        },
      ],
      { date: '2026-10-07', meal: 0 },
    );
    const entries = await d.foodEntries.toArray();
    expect(Object.keys(entriesToMealItems(entries)[0]!).sort()).toEqual([
      'brand',
      'foodId',
      'grams',
      'name',
      'nutrients',
      'per100',
      'portionGrams',
      'portionLabel',
      'quantity',
      'source',
    ]);
    const id = await saveMealFromEntries(d, ' Bowl ', entries);
    expect(await d.meals.get(id)).toMatchObject({ name: 'Bowl', photoId: null, deleted: false });
    expect((await d.meals.get(id))!.items).toEqual(entriesToMealItems(entries));
  });

  it('logs an unsaved AI analysis as a named group without a meal ("Meal eintragen")', async () => {
    const d = db();
    const food = {
      id: 'bls:R',
      source: 'bls' as const,
      sourceId: 'R',
      name: 'Reis gekocht',
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g' as const,
      nutrients: { ENERCC: 130, CHO: 28 },
      portions: [],
    };
    const chicken = { ...food, id: 'bls:H', sourceId: 'H', name: 'Hähnchen', nutrients: { ENERCC: 110 } };
    const n = await logAiItems(
      d,
      '  Bowl vom Foto ',
      [
        { food, grams: 200 },
        { food: chicken, grams: 150 },
      ],
      { date: '2026-10-07', meal: 1 },
      { analysisId: 'a2' },
    );
    expect(n).toBe(2);
    expect(await d.meals.count()).toBe(0);
    expect(await d.photos.count()).toBe(0);
    const entries = await d.foodEntries.orderBy('loggedAt').toArray();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      source: 'ai',
      mealId: null,
      aiAnalysisId: 'a2',
      groupName: 'Bowl vom Foto',
      meal: 1,
      nutrients: { ENERCC: 260, CHO: 56 },
    });
    expect(entries[0]!.groupId).toBeTruthy();
    expect(entries[1]!.groupId).toBe(entries[0]!.groupId);
    expect(entries[1]!.groupName).toBe('Bowl vom Foto');
    // Only the two entries go to the outbox (no meal record).
    expect(await d.outbox.count()).toBe(2);
    // The diary shows them as one group carrying the name.
    const [row] = groupDiaryEntries(entries);
    expect(row).toMatchObject({ kind: 'group', mealId: null, groupName: 'Bowl vom Foto' });
  });

  it('keeps all analysed photos on every entry of an unsaved AI analysis', async () => {
    const d = db();
    const food = {
      id: 'bls:R',
      source: 'bls' as const,
      sourceId: 'R',
      name: 'Reis gekocht',
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g' as const,
      nutrients: { ENERCC: 130 },
      portions: [],
    };
    const photo = new Blob([new Uint8Array([7, 8, 9])], { type: 'image/jpeg' });
    const dessert = new Blob([new Uint8Array([4, 5])], { type: 'image/jpeg' });
    await logAiItems(
      d,
      'Köttbullar',
      [
        { food, grams: 200 },
        { food: { ...food, id: 'bls:S', sourceId: 'S', name: 'Soße' }, grams: 80 },
      ],
      { date: '2026-10-09', meal: 2 },
      { analysisId: 'a4' },
      [photo, dessert],
    );
    const entries = await d.foodEntries.toArray();
    const photoId = entries[0]!.photoId;
    expect(photoId).toBeTruthy();
    expect(entries.map((e) => e.photoId)).toEqual([photoId, photoId]);
    const ids = entries[0]!.photoIds!;
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(photoId);
    expect(entries[1]!.photoIds).toEqual(ids);
    expect(new Uint8Array((await d.photos.get(ids[1]!))!.bytes!)).toEqual(new Uint8Array([4, 5]));
    // Stored on the device and queued for upload; still no saved meal.
    const stored = await d.photos.get(photoId!);
    expect(stored).toMatchObject({ type: 'image/jpeg', uploaded: 0 });
    expect(new Uint8Array(stored!.bytes!)).toEqual(new Uint8Array([7, 8, 9]));
    expect(await d.meals.count()).toBe(0);
  });

  it('puts the photo only on grouped entries', async () => {
    const d = db();
    const item = {
      foodId: null,
      source: 'quick' as const,
      name: 'Tee',
      brand: null,
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: { ENERCC: 2 },
    };
    await logItems(
      d,
      [item, item],
      { date: '2026-10-07', meal: 0 },
      { mealId: 'm1', photoIds: ['p1', 'p3'] },
    );
    await logItems(d, [item], { date: '2026-10-07', meal: 1 }, { photoIds: ['p2'] });
    const entries = await d.foodEntries.orderBy('loggedAt').toArray();
    // Every entry of the group carries all photos; the first is also the thumbnail.
    expect(entries.map((e) => [e.meal, e.photoId, e.photoIds])).toEqual([
      [0, 'p1', ['p1', 'p3']],
      [0, 'p1', ['p1', 'p3']],
      [1, null, null],
    ]);
  });

  it('names an unnamed group and never groups plain logs', async () => {
    const d = db();
    const item = {
      foodId: null,
      source: 'quick' as const,
      name: 'Tee',
      brand: null,
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: { ENERCC: 2 },
    };
    await logItems(d, [item, item], { date: '2026-10-07', meal: 3 }, { groupName: '   ' });
    const entries = await d.foodEntries.toArray();
    // A blank name is no group.
    expect(entries.map((e) => [e.groupId, e.groupName])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('gives every logging of a saved meal its own group, but none to copied entries', async () => {
    const d = db();
    const item = {
      foodId: null,
      source: 'quick' as const,
      name: 'Kaffee',
      brand: null,
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: { ENERCC: 5 },
    };
    const target = { date: '2026-10-07', meal: 0 };
    await logItems(d, [item, item], target, { mealId: 'm1' });
    await logItems(d, [item, item], target, { mealId: 'm1', factor: 2 });
    await logItems(d, [item], target);
    const groups = (await d.foodEntries.toArray()).map((e) => e.groupId);
    expect(new Set(groups.filter(Boolean)).size).toBe(2);
    expect(groups.filter((g) => g === null)).toHaveLength(1);
    expect(await d.foodEntries.filter((e) => e.quantity === 2).count()).toBe(2);
  });

  it('moves entries to another meal and keeps loggedAt/groupId', async () => {
    const d = db();
    const item = {
      foodId: null,
      source: 'quick' as const,
      name: 'Kaffee',
      brand: null,
      grams: null,
      portionLabel: null,
      portionGrams: null,
      quantity: 1,
      per100: null,
      nutrients: { ENERCC: 5 },
    };
    await logItems(d, [item, item], { date: '2026-10-07', meal: 0 }, { mealId: 'm1' });
    await logItems(d, [item], { date: '2026-10-07', meal: 0 });
    const before = await d.foodEntries.orderBy('loggedAt').toArray();
    const group = before.filter((e) => e.groupId);
    await d.outbox.clear();

    await moveEntriesToMeal(
      d,
      group.map((e) => e.id),
      2,
    );
    const after = await d.foodEntries.orderBy('loggedAt').toArray();
    expect(after.map((e) => e.meal)).toEqual([2, 2, 0]);
    expect(after.map((e) => [e.loggedAt, e.groupId, e.date])).toEqual(
      before.map((e) => [e.loggedAt, e.groupId, e.date]),
    );
    expect(after[0]!.updatedAt).toBeGreaterThan(before[0]!.updatedAt);
    // Both moved entries are queued for sync, the untouched one is not.
    expect((await d.outbox.toArray()).map((o) => o.id).sort()).toEqual(group.map((e) => e.id).sort());

    // Undo moves them back; moving to the meal they are in, or a deleted entry, writes nothing.
    await moveEntriesToMeal(
      d,
      group.map((e) => e.id),
      0,
    );
    expect((await d.foodEntries.toArray()).every((e) => e.meal === 0)).toBe(true);
    await d.outbox.clear();
    await moveEntriesToMeal(d, [group[0]!.id], 0);
    await deleteRecord(d, 'foodEntries', group[1]!.id);
    await d.outbox.clear();
    await moveEntriesToMeal(d, [group[1]!.id, 'missing'], 3);
    expect(await d.outbox.count()).toBe(0);
    expect((await d.foodEntries.get(group[1]!.id))!.meal).toBe(0);
  });

  it('saves training templates', async () => {
    const d = db();
    const id = await saveExerciseTemplate(d, {
      name: 'Oberkörper',
      typeKey: 'strength',
      typeName: 'Krafttraining',
      minutes: 60,
      intensity: 'vigorous',
      note: 'Bankdrücken 3 × 8',
    });
    expect(await d.exerciseTemplates.get(id)).toMatchObject({
      name: 'Oberkörper',
      note: 'Bankdrücken 3 × 8',
    });
    expect(await d.outbox.get(`exerciseTemplates:${id}`)).toBeTruthy();
  });

  it('creates and updates exercises', async () => {
    const d = db();
    const data = {
      date: '2026-10-07',
      typeKey: 'running',
      name: 'Laufen',
      minutes: 30,
      intensity: 'moderate' as const,
      met: 9.8,
      weightKg: 80,
      kcal: 352,
      note: null,
    };
    await saveExercise(d, data, null);
    const [x] = await d.exerciseEntries.toArray();
    await saveExercise(d, { ...data, minutes: 45, note: 'Intervalle' }, x!);
    expect(await d.exerciseEntries.count()).toBe(1);
    expect(await d.exerciseEntries.get(x!.id)).toMatchObject({ minutes: 45, note: 'Intervalle' });
  });
});

describe('diary group editor (only these entries, never the saved meal)', () => {
  const food = (name: string, kcalPer100: number): MealItem => ({
    foodId: `bls:${name}`,
    source: 'bls',
    name,
    brand: null,
    grams: 100,
    portionLabel: '1 g',
    portionGrams: 1,
    quantity: 100,
    per100: { ENERCC: kcalPer100 },
    nutrients: { ENERCC: kcalPer100 },
  });

  /** A saved meal "Bowl" with a photo, logged once to lunch on 2026-10-09. */
  async function setup() {
    const d = db();
    const items = [food('Reis', 130), food('Huhn', 110)];
    await saveRecord(d, 'meals', { id: 'm1', name: 'Bowl', items, photoId: 'p1', cookedGrams: null });
    await logItems(
      d,
      items,
      { date: '2026-10-09', meal: 1 },
      { mealId: 'm1', photoIds: ['p1'], aiAnalysisId: 'a1' },
    );
    const entries = await groupEntries(
      d,
      (await d.foodEntries.toCollection().first())!.groupId!,
      '2026-10-09',
    );
    const mealBefore = await d.meals.get('m1');
    return { d, entries, mealBefore, groupId: entries[0]!.groupId! };
  }

  it('starts the draft from the entries with the name the diary shows', async () => {
    const { d, entries, groupId } = await setup();
    expect(await groupName(d, entries)).toBe('Bowl');
    const draft = draftFromEntries(entries, 'Bowl');
    expect(draft).toMatchObject({ groupId, date: '2026-10-09', name: 'Bowl' });
    expect(draft.items.map((i) => [i.name, i.entryId])).toEqual([
      ['Reis', entries[0]!.id],
      ['Huhn', entries[1]!.id],
    ]);
    expect(isGroupDirty(draft, entries, 'Bowl')).toBe(false);
    expect(isGroupDirty({ ...draft, name: '  ' }, entries, 'Bowl')).toBe(false);
    expect(isGroupDirty({ ...draft, name: 'Große Bowl' }, entries, 'Bowl')).toBe(true);
    expect(isGroupDirty({ ...draft, items: draft.items.slice(1) }, entries, 'Bowl')).toBe(true);
  });

  it('a name typed back to the saved meal name follows the meal again', async () => {
    const { d, entries, groupId } = await setup();
    const draft = draftFromEntries(entries, 'Bowl');
    expect(await saveGroupDraft(d, { ...draft, name: 'Große Bowl' })).toBe(true);
    let live = await groupEntries(d, groupId, '2026-10-09');
    expect(live.every((e) => e.groupName === 'Große Bowl')).toBe(true);
    expect(await saveGroupDraft(d, { ...draftFromEntries(live, 'Große Bowl'), name: 'Bowl' })).toBe(true);
    live = await groupEntries(d, groupId, '2026-10-09');
    expect(live.every((e) => e.groupName === null)).toBe(true);
  });

  it('notices a deleted entry even when the remaining ones share the newest version', () => {
    // Two ingredients logged in one transaction can carry the same updatedAt; deleting the newer
    // one must still count as a change (the maximum alone would not move).
    const same = [{ updatedAt: 1000 }, { updatedAt: 1000 }];
    const draft = {
      groupId: 'g',
      date: '2026-10-09',
      name: 'x',
      items: [],
      baseUpdatedAt: groupVersion(same),
    };
    expect(isGroupDraftStale(draft, same)).toBe(false);
    expect(isGroupDraftStale(draft, same.slice(1))).toBe(true);
    expect(isGroupDraftStale(draft, [...same, { updatedAt: 999 }])).toBe(true);
  });

  it('never brings back an ingredient another device deleted meanwhile, and notices the change', async () => {
    const { d, entries, groupId } = await setup();
    const draft = draftFromEntries(entries, 'Bowl');
    expect(isGroupDraftStale(draft, entries)).toBe(false);
    await writeGroupDraft(d, { ...draft, name: 'Große Bowl' });
    // Huhn is deleted on the other device while the editor is open here.
    await deleteRecord(d, 'foodEntries', entries[1]!.id);
    const now = await groupEntries(d, groupId, '2026-10-09');
    expect(isGroupDraftStale((await readGroupDraft(d, groupId))!, now)).toBe(true);
    expect(await saveGroupDraft(d, (await readGroupDraft(d, groupId))!)).toBe(true);
    const live = await groupEntries(d, groupId, '2026-10-09');
    expect(live.map((e) => e.name)).toEqual(['Reis']);
    expect((await d.foodEntries.get(entries[1]!.id))!.deleted).toBe(true);
  });

  it('changes amounts, removes and adds ingredients and renames; the saved meal stays', async () => {
    const { d, entries, mealBefore, groupId } = await setup();
    const draft = draftFromEntries(entries, 'Bowl');
    const reis = draft.items[0]!;
    await writeGroupDraft(d, {
      ...draft,
      name: ' Große Bowl ',
      // Reis doubled, Huhn removed.
      items: [{ ...rescaleItem(reis, 200), entryId: reis.entryId }],
    });
    // "Zutat hinzufügen" through the food search appends to the device draft.
    expect(await addItemToGroupDraft(d, groupId, '2026-10-09', food('Mais', 90))).toBe(true);
    expect(await saveGroupDraft(d, (await readGroupDraft(d, groupId))!)).toBe(true);

    const live = await groupEntries(d, groupId, '2026-10-09');
    expect(live.map((e) => [e.name, e.grams, e.nutrients.ENERCC, e.groupName])).toEqual([
      ['Reis', 200, 260, 'Große Bowl'],
      ['Mais', 100, 90, 'Große Bowl'],
    ]);
    // The new entry belongs to the same group, meal, photo and analysis, after the last entry.
    expect(live[1]).toMatchObject({
      groupId,
      mealId: 'm1',
      photoId: 'p1',
      photoIds: ['p1'],
      aiAnalysisId: 'a1',
      date: '2026-10-09',
      meal: 1,
    });
    expect(live[1]!.loggedAt).toBeGreaterThan(Math.max(...entries.map((e) => e.loggedAt)));
    // Huhn is a tombstone (soft delete, syncs), not gone.
    expect(await d.foodEntries.get(entries[1]!.id)).toMatchObject({ deleted: true });
    // Reis, Huhn and Mais are queued with their new versions; the meal is not written again.
    for (const e of [...live, (await d.foodEntries.get(entries[1]!.id))!])
      expect(await d.outbox.get(`foodEntries:${e.id}`)).toMatchObject({ updatedAt: e.updatedAt });
    expect(await d.outbox.get('meals:m1')).toMatchObject({ updatedAt: mealBefore!.updatedAt });
    expect(await d.meals.get('m1')).toEqual(mealBefore);
    // The draft is gone.
    expect(await readGroupDraft(d, groupId)).toBeNull();
  });

  it('keeps following the saved meal name when the name was not changed', async () => {
    const { d, entries, groupId } = await setup();
    const draft = draftFromEntries(entries, 'Bowl');
    const huhn = draft.items[1]!;
    await saveGroupDraft(d, {
      ...draft,
      items: [draft.items[0]!, { ...rescaleItem(huhn, 50), entryId: huhn.entryId }],
    });
    const live = await groupEntries(d, groupId, '2026-10-09');
    expect(live.map((e) => e.groupName)).toEqual([null, null]);
    // Only the changed entry was written.
    expect(live[0]!.updatedAt).toBe(entries[0]!.updatedAt);
    expect(live[1]!.updatedAt).toBeGreaterThan(entries[1]!.updatedAt);
  });

  it('replaces the ingredients with a new analysis of the photo on "Änderungen übernehmen"', async () => {
    const { d, entries, mealBefore, groupId } = await setup();
    const dbFood = (id: string, name: string, kcal: number, extra: Partial<Food> = {}): Food => ({
      id,
      source: 'bls',
      name,
      sourceId: null,
      nameEn: null,
      brand: null,
      group: null,
      unit: 'g',
      nutrients: { ENERCC: kcal },
      portions: [],
      ...extra,
    });
    const item = { confidence: 'high' as const, preparation: null, packaged: false, searchTerms: [] };
    const result: AiAnalysisResult = {
      analysisId: 'a2',
      dishName: 'Takoyaki',
      items: [
        {
          ...item,
          name: 'Takoyaki',
          grams: 180.4,
          candidates: [
            {
              food: dbFood('est:a2:0', 'Takoyaki', 175, { brand: 'KI-Schätzung', estimated: true }),
              score: 0,
            },
          ],
        },
        {
          ...item,
          name: 'Mayonnaise',
          grams: 15,
          candidates: [{ food: dbFood('bls:M', 'Mayonnaise', 700), score: 1 }],
        },
        { ...item, name: 'Unbekannt', grams: 50, candidates: [] },
      ],
      notes: null,
      model: 'claude-opus-5-5',
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    };
    const draft = draftFromEntries(entries, 'Bowl');
    // A group of a saved meal keeps its name; one without takes the recognised dish.
    expect(groupDraftFromAnalysis(draft, result, false)!.draft.name).toBe('Takoyaki');
    const next = groupDraftFromAnalysis(draft, result, true)!;
    expect(next.foods.map((f) => f.id)).toEqual(['est:a2:0', 'bls:M']);
    expect(next.draft.name).toBe('Bowl');
    expect(isGroupDirty(next.draft, entries, 'Bowl')).toBe(true);
    // Nothing usable: the draft stays.
    expect(groupDraftFromAnalysis(draft, { ...result, items: [result.items[2]!] }, true)).toBeNull();
    // Nothing is written before the save.
    expect((await groupEntries(d, groupId, '2026-10-09')).map((e) => e.name)).toEqual(['Reis', 'Huhn']);

    expect(await saveGroupDraft(d, next.draft)).toBe(true);
    const live = await groupEntries(d, groupId, '2026-10-09');
    expect(
      live.map((e) => [e.name, e.foodId, e.source, e.grams, e.nutrients.ENERCC, e.aiAnalysisId]),
    ).toEqual([
      ['Takoyaki', null, 'ai', 180, 315, 'a2'],
      ['Mayonnaise', 'bls:M', 'ai', 15, 105, 'a2'],
    ]);
    expect(live.every((e) => e.groupId === groupId && e.photoId === 'p1' && e.mealId === 'm1')).toBe(true);
    for (const e of entries) expect(await d.foodEntries.get(e.id)).toMatchObject({ deleted: true });
    expect(await d.meals.get('m1')).toEqual(mealBefore);
  });

  it('appends photos added in the editor to every entry of the group on saving', async () => {
    const { d, entries, mealBefore, groupId } = await setup();
    const jpeg = (b: number) => new Blob([new Uint8Array([b])], { type: 'image/jpeg' });
    await addGroupDraftPhotos(d, groupId, [jpeg(1), jpeg(2)]);
    const added = await readGroupDraftPhotos(d, groupId);
    expect(added).toHaveLength(2);
    // Nothing stored or synced before "Änderungen übernehmen"; one can be taken out again.
    expect(await d.photos.count()).toBe(0);
    await removeGroupDraftPhoto(d, groupId, added[0]!.at);
    expect(await readGroupDraftPhotos(d, groupId)).toHaveLength(1);
    // Also a new ingredient gets all photos.
    const draft = draftFromEntries(entries, 'Bowl');
    draft.items.push({ ...food('Mais', 90), entryId: null });
    expect(await saveGroupDraft(d, draft)).toBe(true);
    const live = await groupEntries(d, groupId, '2026-10-09');
    expect(live).toHaveLength(3);
    const ids = live[0]!.photoIds!;
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('p1');
    for (const e of live) expect(e).toMatchObject({ photoId: 'p1', photoIds: ids });
    expect(new Uint8Array((await d.photos.get(ids[1]!))!.bytes!)).toEqual(new Uint8Array([2]));
    expect(await readGroupDraftPhotos(d, groupId)).toEqual([]);
    expect(await d.meals.get('m1')).toEqual(mealBefore);
  });

  it('leaves the photos of the entries alone without added ones, and drops added ones with the draft', async () => {
    const { d, entries, groupId } = await setup();
    const draft = draftFromEntries(entries, 'Bowl');
    expect(await saveGroupDraft(d, { ...draft, name: 'Große Bowl' })).toBe(true);
    expect((await groupEntries(d, groupId, '2026-10-09'))[0]).toMatchObject({
      photoId: 'p1',
      photoIds: ['p1'],
    });
    await addGroupDraftPhotos(d, groupId, [new Blob([new Uint8Array([1])], { type: 'image/jpeg' })]);
    await clearGroupDraft(d, groupId);
    expect(await readGroupDraftPhotos(d, groupId)).toEqual([]);
  });

  it('refuses an empty group and reports a group that is gone', async () => {
    const { d, entries, groupId } = await setup();
    const draft = draftFromEntries(entries, 'Bowl');
    await expect(saveGroupDraft(d, { ...draft, items: [] })).rejects.toThrow();
    for (const e of entries) await deleteRecord(d, 'foodEntries', e.id);
    expect(await saveGroupDraft(d, draft)).toBe(false);
    expect(await addItemToGroupDraft(d, groupId, '2026-10-09', food('Mais', 90))).toBe(false);
  });
});

describe('diary clipboard (copy by swiping right, paste into a meal)', () => {
  const item = (name: string, kcal: number): MealItem => ({
    foodId: null,
    source: 'quick',
    name,
    brand: null,
    grams: 100,
    portionLabel: '1 g',
    portionGrams: 1,
    quantity: 100,
    per100: null,
    nutrients: { ENERCC: kcal },
  });
  const live = (d: UserDb, date: string) =>
    d.foodEntries
      .where('date')
      .equals(date)
      .filter((e) => !e.deleted)
      .sortBy('loggedAt');

  it('logItems returns the ids of the new entries in order', async () => {
    const d = db();
    const ids = await logItems(d, [item('A', 1), item('B', 2)], { date: '2026-10-07', meal: 0 });
    expect((await live(d, '2026-10-07')).map((e) => e.id)).toEqual(ids);
  });

  it('pastes a copied group as a new group with the same meal, name, analysis and photos', async () => {
    const d = db();
    await logItems(
      d,
      [item('Reis', 130), item('Curry', 200)],
      { date: '2026-10-07', meal: 1 },
      {
        groupName: 'Curry vom Foto',
        aiAnalysisId: 'a1',
        photoIds: ['p1', 'p2'],
      },
    );
    const source = await live(d, '2026-10-07');
    await copyToClipboard(d, 'group', 'Curry vom Foto', source);
    // The clipboard is a snapshot: deleting the source does not empty it.
    for (const e of source) await deleteRecord(d, 'foodEntries', e.id);
    const clip = (await readClipboard(d))!;
    expect(clip).toMatchObject({ kind: 'group', name: 'Curry vom Foto', photoIds: ['p1', 'p2'] });
    expect(clipboardKcal(clip)).toBe(330);

    const ids = await pasteClipboard(d, clip, { date: '2026-10-08', meal: 3 });
    const pasted = await live(d, '2026-10-08');
    expect(pasted.map((e) => e.id)).toEqual(ids);
    expect(new Set(pasted.map((e) => e.groupId)).size).toBe(1);
    expect(pasted[0]!.groupId).not.toBe(source[0]!.groupId);
    expect(pasted.map((e) => e.id)).not.toContain(source[0]!.id);
    expect(pasted.map((e) => [e.meal, e.name, e.groupName, e.aiAnalysisId, e.photoId, e.photoIds])).toEqual([
      [3, 'Reis', 'Curry vom Foto', 'a1', 'p1', ['p1', 'p2']],
      [3, 'Curry', 'Curry vom Foto', 'a1', 'p1', ['p1', 'p2']],
    ]);
    const rows = groupDiaryEntries(pasted);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('group');

    // It stays filled after pasting: a second paste is another group.
    await pasteClipboard(d, (await readClipboard(d))!, { date: '2026-10-08', meal: 0 });
    expect(new Set((await live(d, '2026-10-08')).map((e) => e.groupId)).size).toBe(2);
  });

  it('keeps the saved meal of a copied meal group', async () => {
    const d = db();
    await logItems(
      d,
      [item('Brot', 250), item('Käse', 100)],
      { date: '2026-10-07', meal: 0 },
      { mealId: 'm1' },
    );
    await copyToClipboard(d, 'group', 'Frühstücksbrot', await live(d, '2026-10-07'));
    await pasteClipboard(d, (await readClipboard(d))!, { date: '2026-10-09', meal: 0 });
    expect((await live(d, '2026-10-09')).map((e) => [e.mealId, e.groupName])).toEqual([
      ['m1', null],
      ['m1', null],
    ]);
  });

  it('pastes a copied entry as a plain entry, also when it was part of a group', async () => {
    const d = db();
    await logItems(
      d,
      [item('Reis', 130), item('Curry', 200)],
      { date: '2026-10-07', meal: 1 },
      {
        groupName: 'Curry',
        photoIds: ['p1'],
      },
    );
    const [rice] = await live(d, '2026-10-07');
    await copyToClipboard(d, 'entry', rice!.name, [rice!]);
    expect(await readClipboard(d)).toMatchObject({
      kind: 'entry',
      mealId: null,
      groupName: null,
      photoIds: [],
    });
    await pasteClipboard(d, (await readClipboard(d))!, { date: '2026-10-08', meal: 2 });
    expect((await live(d, '2026-10-08')).map((e) => [e.name, e.groupId, e.photoId, e.photoIds])).toEqual([
      ['Reis', null, null, null],
    ]);
  });

  it('replaces the clipboard on a new copy and clears it', async () => {
    const d = db();
    await logItems(d, [item('A', 1), item('B', 2)], { date: '2026-10-07', meal: 0 });
    const [a, b] = await live(d, '2026-10-07');
    await copyToClipboard(d, 'entry', 'A', [a!]);
    await copyToClipboard(d, 'entry', 'B', [b!]);
    expect((await readClipboard(d))!.name).toBe('B');
    await clearClipboard(d);
    expect(await readClipboard(d)).toBeNull();
  });

  it('saves items as a meal with a shared photo id', async () => {
    const d = db();
    const id = await saveMealFromItems(d, ' Curry ', [item('Reis', 130)], 'p1');
    expect(await d.meals.get(id)).toMatchObject({ name: 'Curry', photoId: 'p1', deleted: false });
    expect((await d.meals.get(id))!.items.map((i) => i.name)).toEqual(['Reis']);
  });
});

describe('settings, notes and onboarding writes', () => {
  it('saveSettings patches the current record, or the defaults when there is none', async () => {
    const d = db();
    const first = await saveSettings(d, { mealNames: ['A', 'B', 'C', 'D'] });
    expect(first).toMatchObject({ id: 'profile', mealNames: ['A', 'B', 'C', 'D'], weeklyRateKg: -0.5 });
    // A second page saves other fields: the meal names stay.
    await saveSettings(d, { heightCm: 180 });
    expect(await d.settings.get('profile')).toMatchObject({ mealNames: ['A', 'B', 'C', 'D'], heightCm: 180 });
    expect(await d.outbox.count()).toBe(1);
  });

  it('saveDayNote keeps the completed state of the day', async () => {
    const d = db();
    await saveRecord(d, 'dayNotes', {
      id: dayId.note('2026-10-07'),
      date: '2026-10-07',
      note: '',
      completedAt: 5,
    });
    await saveDayNote(d, '2026-10-07', 'Gut gelaufen');
    expect(await d.dayNotes.get(dayId.note('2026-10-07'))).toMatchObject({
      note: 'Gut gelaufen',
      completedAt: 5,
    });
  });

  it('running the calculator again neither re-logs the old weight nor drops micro targets', async () => {
    const d = db();
    const profile = {
      sex: 'female' as const,
      birthDate: '1990-06-15',
      heightCm: 168,
      activityLevel: 'light' as const,
      targetWeightKg: 60,
      weeklyRateKg: -0.5,
      macroPlan: null,
    };
    const target = { kcal: 1800, proteinG: 110, fatG: 60, carbsG: 200 };
    await saveOnboarding(d, { base: DEFAULT_SETTINGS, profile, weightKg: 70, target, today: '2026-10-01' });
    expect(await d.weightEntries.get(dayId.weight('2026-10-01'))).toMatchObject({ kg: 70 });
    await patchRecord(d, 'goals', dayId.goal('2026-10-01'), { micros: { FIBT: 40 } });

    // Three weeks later with the prefilled (old) weight: no new weight entry, fiber target kept.
    const base = (await d.settings.get('profile'))!;
    await saveOnboarding(d, {
      base,
      profile,
      weightKg: 70,
      target: { ...target, kcal: 1700 },
      today: '2026-10-22',
    });
    expect(await d.weightEntries.get(dayId.weight('2026-10-22'))).toBeUndefined();
    expect(await d.goals.get(dayId.goal('2026-10-22'))).toMatchObject({
      micros: { FIBT: 40 },
      days: expect.any(Array),
    });

    // A different weight is a real measurement.
    await saveOnboarding(d, { base, profile, weightKg: 68.5, target, today: '2026-10-23' });
    expect(await d.weightEntries.get(dayId.weight('2026-10-23'))).toMatchObject({ kg: 68.5 });
  });
});

describe('JSON backup', () => {
  it('restores records that are newer than the device has, skips the rest and invalid ones', async () => {
    const a = db();
    const w = await saveRecord(a, 'weightEntries', {
      id: dayId.weight('2026-10-07'),
      date: '2026-10-07',
      kg: 80,
    });
    const n = await saveRecord(a, 'dayNotes', {
      id: dayId.note('2026-10-07'),
      date: '2026-10-07',
      note: 'alt',
      completedAt: null,
    });
    const backup = parseBackup(JSON.stringify(await createBackup(a, 'test')));
    expect(backup.weightEntries).toHaveLength(1);
    // Later: the note changed on the device, the weight was lost (new device).
    await patchRecord(a, 'dayNotes', n.id, { note: 'neu' });
    const b = db();
    await saveRecord(b, 'dayNotes', { id: n.id, date: '2026-10-07', note: 'neu', completedAt: null });
    (backup.customFoods as unknown[]).push({ id: 'x', updatedAt: 1, deleted: false, name: 7 });
    const r = await restoreBackup(b, backup);
    expect(r).toEqual({ restored: 1, unchanged: 1, invalid: { customFoods: 1 } });
    expect(await b.weightEntries.get(w.id)).toMatchObject({ kg: 80 });
    expect((await b.weightEntries.get(w.id))!.updatedAt).toBeGreaterThan(w.updatedAt);
    expect(await b.dayNotes.get(n.id)).toMatchObject({ note: 'neu' });
    expect(await b.outbox.count()).toBe(2);
    expect(() => parseBackup('{"app":"other"}')).toThrow();
  });
});
