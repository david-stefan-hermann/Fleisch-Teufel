import {
  dayId,
  dailyRows,
  groupDiaryEntries,
  rescaleItem,
  uuidv7,
  type AiAnalysisResult,
  type Food,
  type MealItem,
  trainingItemsOf,
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
  logQuickEntry,
  moveEntriesToMeal,
  readPhotoBytes,
  reorderTrainings,
  logTrainings,
  quickEntryText,
  saveExercise,
  saveTraining,
  updateTraining,
  saveMealFromEntries,
  saveMealFromItems,
  saveQuickEntry,
} from '@/db/entries';
import {
  addGroupDraftPhotos,
  addItemToGroupDraft,
  addItemsToGroupDraft,
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
  saveGroupAsMeal,
  saveGroupDraft,
  writeGroupDraft,
} from '@/db/groupDraft';
import {
  clearClipboard,
  clipboardKcal,
  copyMealToClipboard,
  foodClipboard,
  copyToClipboard,
  pasteClipboard,
  readClipboard,
} from '@/db/clipboard';
import {
  purgeRecords,
  purgeTrash,
  trashCount,
  trashedMeals,
  trashedSteps,
  trashedTrainings,
  trashedWeights,
} from '@/db/trash';
import {
  addActivityToTraining,
  isTrainingDirty,
  readTrainingDraft,
  saveTrainingDraft,
  startNewTraining,
} from '@/db/trainingDraft';
import { createBackup, parseBackup, restoreBackup } from '@/db/backup';
import { completeDays, openDays, openPastDays, reopenDays, saveDayNote } from '@/db/notes';
import { DEFAULT_SETTINGS, saveSettings } from '@/db/settings';
import { deleteRecord, patchRecord, restoreRecord, saveRecord, upsertRecord } from '@/db/write';
import { localOnlyData } from '@/db/localOnly';
import { storePhoto } from '@/db/photos';
import { wipeWarning } from '@/features/more/wipeWarning';
import { saveOnboarding } from '@/features/goals/saveOnboarding';
import { dailyCsv, entriesCsv, exerciseCsv } from '@/features/reports/export';

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

  it('refuses a one-per-day record under another id before it reaches the outbox', async () => {
    const d = db();
    const steps = {
      id: uuidv7(),
      date: '2026-11-10',
      loggedAt: 1,
      typeKey: 'steps',
      name: 'Schritte',
      minutes: 76,
      intensity: 'moderate' as const,
      met: 3.5,
      weightKg: 80,
      kcal: 234,
      note: null,
      templateId: null,
      groupId: null,
      steps: 8432,
      distanceM: 6100,
    };
    await expect(saveRecord(d, 'exerciseEntries', steps)).rejects.toThrow('id must be s:2026-11-10');
    await expect(
      saveRecord(d, 'weightEntries', { id: dayId.weight('2026-11-09'), date: '2026-11-10', kg: 80 }),
    ).rejects.toThrow('id must be w:2026-11-10');
    expect(await d.outbox.count()).toBe(0);
    expect(await d.exerciseEntries.count()).toBe(0);
    await saveRecord(d, 'exerciseEntries', { ...steps, id: dayId.steps('2026-11-10') });
    expect(await d.outbox.count()).toBe(1);
  });

  it('pages that build a record from their fields keep fields a newer app version added', async () => {
    const d = db();
    const id = dayId.note('2026-10-07');
    await saveRecord(d, 'dayNotes', { id, date: '2026-10-07', note: 'alt', completedAt: null });
    // As pulled from a device with a newer app version.
    await d.dayNotes.update(id, { mood: 'gut' } as never);
    await saveDayNote(d, '2026-10-07', 'neu');
    await completeDays(d, ['2026-10-07'], 7);
    expect(await d.dayNotes.get(id)).toMatchObject({ note: 'neu', completedAt: 7, mood: 'gut' });
    // A tombstone written over becomes a live record again.
    await deleteRecord(d, 'dayNotes', id);
    await upsertRecord(d, 'dayNotes', id, () => ({ id, date: '2026-10-07', note: 'x', completedAt: null }));
    expect(await d.dayNotes.get(id)).toMatchObject({ deleted: false, note: 'x', mood: 'gut' });
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
      items: [
        { typeKey: 'running', typeName: 'Laufen', minutes: 30, intensity: 'moderate' as const, note: null },
      ],
    });
    const t1 = await saveTraining(d, training('Bahntraining'));
    const t2 = await saveTraining(d, training('Dauerlauf'));
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

  it('purges trash records for good: hidden, a new version in the outbox, restore brings them back', async () => {
    const d = db();
    for (const date of ['2026-10-01', '2026-10-02'])
      await saveRecord(d, 'weightEntries', { id: dayId.weight(date), date, kg: 80 });
    const [a, b] = ['2026-10-01', '2026-10-02'].map((date) => dayId.weight(date)) as [string, string];
    await deleteRecord(d, 'weightEntries', a);
    await deleteRecord(d, 'weightEntries', b);
    const before = (await d.weightEntries.get(a))!.updatedAt;
    await d.outbox.clear();

    expect(await purgeRecords(d, [{ table: 'weightEntries', id: a }])).toBe(1);
    const purged = (await d.weightEntries.get(a))!;
    expect(purged.deleted).toBe(true);
    expect(purged.purgedAt).toEqual(expect.any(Number));
    expect(purged.updatedAt).toBeGreaterThan(before);
    expect((await d.outbox.toArray()).map((o) => o.key)).toEqual([`weightEntries:${a}`]);
    expect((await trashedWeights(d)).map((w) => w.id)).toEqual([b]);
    expect(await trashCount(d)).toBe(1);

    // Restored on another device in the meantime: the purge skips it, as it skips a purged one.
    await restoreRecord(d, 'weightEntries', b);
    expect(
      await purgeRecords(d, [
        { table: 'weightEntries', id: a },
        { table: 'weightEntries', id: b },
      ]),
    ).toBe(0);
    expect((await d.weightEntries.get(b))!.deleted).toBe(false);

    // Restoring a purged record clears the mark; deleted again, it is back in the trash.
    await restoreRecord(d, 'weightEntries', a);
    expect((await d.weightEntries.get(a))!).toMatchObject({ deleted: false, purgedAt: null });
    await deleteRecord(d, 'weightEntries', a);
    expect((await trashedWeights(d)).map((w) => w.id)).toEqual([a]);
  });

  it('empties the whole trash in one go', async () => {
    const d = db();
    await saveRecord(d, 'weightEntries', { id: dayId.weight('2026-10-01'), date: '2026-10-01', kg: 80 });
    await deleteRecord(d, 'weightEntries', dayId.weight('2026-10-01'));
    const t = await saveTraining(d, {
      name: 'Dauerlauf',
      items: [{ typeKey: 'running', typeName: 'Laufen', minutes: 30, intensity: 'moderate', note: null }],
    });
    await deleteRecord(d, 'exerciseTemplates', t);
    expect(await trashCount(d)).toBe(2);
    expect(await purgeTrash(d)).toBe(2);
    expect(await trashCount(d)).toBe(0);
    expect(await purgeTrash(d)).toBe(0);
  });

  it('rejects invalid records without touching the outbox', async () => {
    const d = db();
    await expect(
      saveRecord(d, 'weightEntries', { id: 'w:2026-10-09', date: '2026-10-09', kg: 5 }),
    ).rejects.toThrow();
    expect(await d.outbox.count()).toBe(0);
  });

  it('logs a quick entry: the values, the full text as note, its beginning as the name', async () => {
    const d = db();
    const text =
      'Beim Italiener gegessen. Pizza Salami, dazu ein kleiner gemischter Salat.\nDanach noch ein Espresso.';
    const id = await logQuickEntry(d, '2026-11-06', {
      meal: 2,
      text: `  ${text}  `,
      kcal: 950,
      proteinG: 40,
      carbsG: null,
      fatG: 0,
    });
    const saved = (await d.foodEntries.get(id))!;
    expect(saved).toMatchObject({
      date: '2026-11-06',
      meal: 2,
      source: 'quick',
      foodId: null,
      name: 'Beim Italiener gegessen. Pizza Salami, dazu ein kleiner…',
      note: text,
      nutrients: { ENERCC: 950, PROT625: 40 },
      grams: null,
      groupId: null,
      mealId: null,
    });
    expect(quickEntryText(saved)).toBe(text);
    // Without a text: "Schnelleingabe", no note.
    const plain = (await d.foodEntries.get(
      await logQuickEntry(d, '2026-11-06', {
        meal: 0,
        text: ' ',
        kcal: 200,
        proteinG: null,
        carbsG: null,
        fatG: null,
      }),
    ))!;
    expect(plain).toMatchObject({ name: 'Schnelleingabe', note: null });
    expect(quickEntryText(plain)).toBe('');

    // Editing changes text, values and meal; the day, the time and the id stay.
    await saveQuickEntry(d, saved, {
      meal: 1,
      text: 'Pizza Salami',
      kcal: 900,
      proteinG: null,
      carbsG: 100,
      fatG: null,
    });
    expect(await d.foodEntries.get(id)).toMatchObject({
      id,
      date: '2026-11-06',
      loggedAt: saved.loggedAt,
      meal: 1,
      name: 'Pizza Salami',
      note: 'Pizza Salami',
      nutrients: { ENERCC: 900, CHO: 100 },
    });
    expect(await d.foodEntries.count()).toBe(2);
  });

  it('a quick entry of an older app version shows its own name as text and keeps a default name', async () => {
    const d = db();
    const old = async (name: string) => {
      const id = await logQuickEntry(d, '2026-11-06', {
        meal: 0,
        text: '',
        kcal: 100,
        proteinG: null,
        carbsG: null,
        fatG: null,
      });
      await patchRecord(d, 'foodEntries', id, { name });
      return (await d.foodEntries.get(id))!;
    };
    const croissant = await old('Croissant');
    expect(quickEntryText(croissant)).toBe('Croissant');
    const unnamed = await old('Schnell hinzugefügt');
    expect(quickEntryText(unnamed)).toBe('');
    // Saved without a text, it is not renamed.
    await saveQuickEntry(d, unnamed, {
      meal: 0,
      text: '',
      kcal: 150,
      proteinG: null,
      carbsG: null,
      fatG: null,
    });
    expect(await d.foodEntries.get(unnamed.id)).toMatchObject({ name: 'Schnell hinzugefügt', note: null });
  });

  it('copies of a quick entry keep its note; as an ingredient of a meal it has none', async () => {
    const d = db();
    const y = '2026-11-05';
    const id = await logQuickEntry(d, y, {
      meal: 1,
      text: 'Kantine: Schnitzel mit Pommes',
      kcal: 800,
      proteinG: null,
      carbsG: null,
      fatG: null,
    });
    const source = (await d.foodEntries.get(id))!;
    // Swipe right, paste on another day.
    const clip = await copyToClipboard(d, 'entry', source.name, [source]);
    const [pasted] = await pasteClipboard(d, clip, { date: '2026-11-06', meal: 1 });
    expect(await d.foodEntries.get(pasted!)).toMatchObject({
      name: 'Kantine: Schnitzel mit Pommes',
      note: 'Kantine: Schnitzel mit Pommes',
      groupId: null,
    });
    // The whole diary meal copied: the same.
    const mealClip = await copyMealToClipboard(d, 'Mittagessen', [source]);
    const [again] = await pasteClipboard(d, mealClip, { date: '2026-11-06', meal: 2 });
    expect((await d.foodEntries.get(again!))!.note).toBe('Kantine: Schnitzel mit Pommes');
    // Saved as a meal, the entry is an ingredient: only the item fields.
    const mealId = await saveMealFromEntries(d, 'Kantine', [source]);
    expect((await d.meals.get(mealId))!.items[0]).not.toHaveProperty('note');
    expect(entriesToMealItems([source])[0]).not.toHaveProperty('note');
    // Logged from that meal: a group, no note.
    const [fromMeal] = await logItems(
      d,
      [{ ...entriesToMealItems([source])[0]!, note: 'x' }],
      { date: '2026-11-06', meal: 0 },
      { mealId },
    );
    expect((await d.foodEntries.get(fromMeal!))!.note).toBeNull();
  });

  it('exports the note of a quick entry as the last column', async () => {
    const d = db();
    await logQuickEntry(d, '2026-11-06', {
      meal: 0,
      text: 'Brötchen beim Bäcker',
      kcal: 300,
      proteinG: null,
      carbsG: null,
      fatG: null,
    });
    const csv = entriesCsv(await d.foodEntries.toArray(), ['Frühstück'], 'excel-de');
    const [header, row] = csv.trim().split(/\r?\n/);
    expect(header!.split(';').at(-1)).toBe('Notiz');
    expect(row!.split(';').at(-1)).toBe('Brötchen beim Bäcker');
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
    expect(n).toHaveLength(1);
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
      await readPhotoBytes([photo, side]),
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
    expect(n).toHaveLength(2);
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

  it('saves trainings with one or more activities and updates them', async () => {
    const d = db();
    const strength = {
      typeKey: 'strength',
      typeName: 'Krafttraining',
      minutes: 60,
      intensity: 'vigorous' as const,
      note: 'Bankdrücken 3 × 8',
    };
    const stretch = {
      typeKey: 'stretching',
      typeName: 'Dehnen',
      minutes: 15,
      intensity: 'light' as const,
      note: '',
    };
    const one = await saveTraining(d, { name: 'Oberkörper', items: [strength] });
    expect(await d.exerciseTemplates.get(one)).toMatchObject({
      name: 'Oberkörper',
      note: 'Bankdrücken 3 × 8',
      extraItems: null,
      pinned: null,
    });
    expect(await d.outbox.get(`exerciseTemplates:${one}`)).toBeTruthy();

    const gym = await saveTraining(d, { name: ' Gym-Besuch ', items: [strength, stretch], pinned: true });
    const saved = (await d.exerciseTemplates.get(gym))!;
    expect(saved).toMatchObject({ name: 'Gym-Besuch', typeKey: 'strength', pinned: true });
    expect(saved.extraItems).toEqual([{ ...stretch, note: null }]);
    expect(trainingItemsOf(saved).map((i) => i.typeKey)).toEqual(['strength', 'stretching']);

    // Only the given fields change; one activity left clears `extraItems`.
    expect(await updateTraining(d, gym, { items: [{ ...stretch, minutes: 20 }] })).toBe(true);
    expect(await d.exerciseTemplates.get(gym)).toMatchObject({
      name: 'Gym-Besuch',
      typeKey: 'stretching',
      minutes: 20,
      extraItems: null,
      pinned: true,
    });
    expect(await updateTraining(d, gym, { pinned: false, name: 'Gym' })).toBe(true);
    expect(await d.exerciseTemplates.get(gym)).toMatchObject({ name: 'Gym', pinned: null, minutes: 20 });
    await deleteRecord(d, 'exerciseTemplates', gym);
    expect(await updateTraining(d, gym, { name: 'x' })).toBe(false);
    expect(await updateTraining(d, 'missing', { name: 'x' })).toBe(false);
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
      templateId: null,
    };
    await saveExercise(d, data, null);
    const [x] = await d.exerciseEntries.toArray();
    // The page passes the date of its URL; editing keeps the entry's own day.
    await saveExercise(d, { ...data, date: '2026-10-09', minutes: 45, note: 'Intervalle' }, x!);
    expect(await d.exerciseEntries.count()).toBe(1);
    expect(await d.exerciseEntries.get(x!.id)).toMatchObject({
      minutes: 45,
      note: 'Intervalle',
      date: '2026-10-07',
    });
  });

  it('exports the saved training of a training entry as the last column', async () => {
    const d = db();
    const template = await saveTraining(d, {
      name: 'Push Day',
      items: [
        { typeKey: 'strength', typeName: 'Krafttraining', minutes: 60, intensity: 'moderate', note: null },
      ],
    });
    const training = (templateId: string | null) => ({
      typeKey: 'strength',
      name: 'Krafttraining',
      minutes: 60,
      intensity: 'moderate' as const,
      met: 6,
      weightKg: 80,
      kcal: 400,
      note: null,
      templateId,
    });
    await logTrainings(d, '2026-11-06', [training(template), training(null)]);
    const csv = exerciseCsv(await d.exerciseEntries.toArray(), 'excel-de', new Map([[template, 'Push Day']]));
    const [header, first, second] = csv.trim().split(/\r?\n/);
    expect(header!.split(';').at(-1)).toBe('Training');
    expect(first!.split(';').at(-1)).toBe('Push Day');
    expect(second!.split(';').at(-1)).toBe('');
    expect(await d.exerciseEntries.where('date').equals('2026-11-06').sortBy('loggedAt')).toMatchObject([
      { templateId: template },
      { templateId: null },
    ]);
  });

  it('puts steps and distance at the end of the daily CSV', () => {
    const rows = dailyRows({
      from: '2026-11-09',
      to: '2026-11-10',
      entries: [],
      exercises: [
        {
          id: 's:2026-11-10',
          updatedAt: 1,
          deleted: false,
          date: '2026-11-10',
          typeKey: 'steps',
          name: 'Schritte',
          minutes: 76,
          intensity: 'moderate',
          met: 3.5,
          weightKg: 80,
          kcal: 253,
          loggedAt: 1,
          note: null,
          templateId: null,
          groupId: null,
          steps: 8432,
          distanceM: 6100,
          purgedAt: null,
        },
      ],
      weights: [],
      goals: [],
    });
    const [header, monday, tuesday] = dailyCsv(rows, 'excel-de').trim().split(/\r?\n/);
    expect(header!.split(';').slice(-2)).toEqual(['Schritte', 'Distanz (m)']);
    expect(monday!.split(';').slice(-2)).toEqual(['', '']);
    expect(tuesday!.split(';').slice(-2)).toEqual(['8432', '6100']);
  });

  it('keeps deleted steps in the trash until restored', async () => {
    const d = db();
    const steps = {
      id: 's:2026-11-09',
      date: '2026-11-09',
      typeKey: 'steps',
      name: 'Schritte',
      minutes: 104,
      intensity: 'moderate' as const,
      met: 3.5,
      weightKg: 80,
      kcal: 347,
      loggedAt: 1,
      note: null,
      templateId: null,
      groupId: null,
      steps: 11204,
      distanceM: 8340,
    };
    await saveRecord(d, 'exerciseEntries', steps);
    await logTrainings(d, '2026-11-09', [
      {
        typeKey: 'running',
        name: 'Laufen',
        minutes: 30,
        intensity: 'moderate',
        met: 9.8,
        weightKg: 80,
        kcal: 300,
        note: null,
      },
    ]);
    const run = (await d.exerciseEntries.filter((e) => e.typeKey === 'running').first())!;
    await deleteRecord(d, 'exerciseEntries', steps.id);
    // A deleted training is no trash item (it comes back with undo only), deleted steps are.
    await deleteRecord(d, 'exerciseEntries', run.id);
    expect((await trashedSteps(d)).map((e) => e.id)).toEqual(['s:2026-11-09']);
    expect(await trashCount(d)).toBe(1);
    await restoreRecord(d, 'exerciseEntries', steps.id);
    expect(await trashedSteps(d)).toEqual([]);
    expect(await d.exerciseEntries.get(steps.id)).toMatchObject({ deleted: false, steps: 11204 });
  });

  it('logs several trainings at once, in order, each queued for the server', async () => {
    const d = db();
    const row = (typeKey: string, name: string, minutes: number) => ({
      typeKey,
      name,
      minutes,
      intensity: 'moderate' as const,
      met: 6,
      weightKg: 80,
      kcal: 200,
      note: null,
      templateId: null,
    });
    const ids = await logTrainings(d, '2026-10-07', [
      row('strength', 'Krafttraining', 60),
      row('stretching', 'Dehnen', 15),
    ]);
    expect(ids).toHaveLength(2);
    const entries = await d.exerciseEntries.where('date').equals('2026-10-07').sortBy('loggedAt');
    expect(entries.map((e) => e.name)).toEqual(['Krafttraining', 'Dehnen']);
    expect(entries[0]!.loggedAt).toBeLessThan(entries[1]!.loggedAt);
    expect(entries.map((e) => e.id)).toEqual(ids);
    expect(await d.outbox.filter((o) => o.table === 'exerciseEntries').count()).toBe(2);
    expect(entries.map((e) => e.groupId)).toEqual([null, null]);
  });

  it('gives the activities of one saved training a shared, fresh group id', async () => {
    const d = db();
    const row = (typeKey: string, group?: string) => ({
      typeKey,
      name: typeKey,
      minutes: 30,
      intensity: 'moderate' as const,
      met: 6,
      weightKg: 80,
      kcal: 200,
      note: null,
      ...(group !== undefined && { group, templateId: 't1' }),
    });
    await logTrainings(d, '2026-10-07', [row('strength', 'a'), row('stretching', 'a'), row('running')]);
    await logTrainings(d, '2026-10-07', [row('strength', 'a'), row('stretching', 'a')]);
    const entries = await d.exerciseEntries.where('date').equals('2026-10-07').sortBy('loggedAt');
    const [a, b, single, c, e] = entries;
    expect(a!.groupId).toBeTruthy();
    expect(b!.groupId).toBe(a!.groupId);
    expect(single).toMatchObject({ groupId: null, templateId: null });
    expect(c!.groupId).toBe(e!.groupId);
    expect(c!.groupId).not.toBe(a!.groupId);
    expect(a!.templateId).toBe('t1');
    // Editing a part keeps its group.
    await saveExercise(d, { ...row('strength'), date: '2026-10-07', minutes: 45 }, a!);
    expect(await d.exerciseEntries.get(a!.id)).toMatchObject({
      groupId: a!.groupId,
      templateId: 't1',
      minutes: 45,
    });
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

  it('removes saved photos taken out in the editor from every entry of the group', async () => {
    const { d, entries, groupId } = await setup();
    const jpeg = new Blob([new Uint8Array([5])], { type: 'image/jpeg' });
    await addGroupDraftPhotos(d, groupId, [jpeg]);
    const draft = { ...draftFromEntries(entries, 'Bowl'), removedPhotoIds: ['p1'] };
    expect(isGroupDirty(draft, entries, 'Bowl')).toBe(true);
    expect(await saveGroupDraft(d, draft)).toBe(true);
    const live = await groupEntries(d, groupId, '2026-10-09');
    const ids = live[0]!.photoIds!;
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe('p1');
    for (const e of live) expect(e).toMatchObject({ photoId: ids[0], photoIds: ids });

    // The last photo removed: the entries have none left.
    const again = { ...draftFromEntries(live, 'Bowl'), removedPhotoIds: ids };
    expect(await saveGroupDraft(d, again)).toBe(true);
    for (const e of await groupEntries(d, groupId, '2026-10-09'))
      expect(e).toMatchObject({ photoId: null, photoIds: null });
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
    const clip = foodClipboard(await readClipboard(d))!;
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
    await pasteClipboard(d, foodClipboard(await readClipboard(d))!, { date: '2026-10-08', meal: 0 });
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
    await pasteClipboard(d, foodClipboard(await readClipboard(d))!, { date: '2026-10-09', meal: 0 });
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
    await pasteClipboard(d, foodClipboard(await readClipboard(d))!, { date: '2026-10-08', meal: 2 });
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
  it('restores only what the device lacks, with the version of the backup', async () => {
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
    // A record deleted before the backup was taken, and a weight under a wrong id.
    (backup.weightEntries as unknown[]).push(
      { id: dayId.weight('2026-10-01'), updatedAt: 1, deleted: true, date: '2026-10-01', kg: 79 },
      { id: dayId.weight('2026-10-02'), updatedAt: 1, deleted: false, date: '2026-10-03', kg: 79 },
    );
    const r = await restoreBackup(b, backup);
    expect(r).toEqual({ restored: 1, unchanged: 2, invalid: { customFoods: 1, weightEntries: 1 } });
    expect(await b.weightEntries.get(w.id)).toMatchObject({ kg: 80 });
    // The backup's version: last write wins decides against the server, not a fresh stamp.
    expect((await b.weightEntries.get(w.id))!.updatedAt).toBe(w.updatedAt);
    expect(await b.outbox.get(`weightEntries:${w.id}`)).toMatchObject({ updatedAt: w.updatedAt });
    expect(await b.weightEntries.get(dayId.weight('2026-10-01'))).toBeUndefined();
    expect(await b.dayNotes.get(n.id)).toMatchObject({ note: 'neu' });
    expect(await b.outbox.count()).toBe(2);
    expect(() => parseBackup('{"app":"other"}')).toThrow();
  });
});

describe('diary clipboard: a whole diary meal', () => {
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
  const live = (d: UserDb, date: string, meal: number) =>
    d.foodEntries
      .where('[date+meal]')
      .equals([date, meal])
      .filter((e) => !e.deleted)
      .sortBy('loggedAt');

  it('copies single entries and groups and pastes them with the same structure', async () => {
    const d = db();
    await logItems(d, [item('Brot', 250)], { date: '2026-10-07', meal: 1 });
    await logItems(
      d,
      [item('Reis', 130), item('Curry', 200)],
      { date: '2026-10-07', meal: 1 },
      { mealId: 'm1', aiAnalysisId: 'a1', photoIds: ['p1', 'p2'] },
    );
    const source = await live(d, '2026-10-07', 1);
    const clip = await copyMealToClipboard(d, 'Mittagessen', source);
    expect(clip).toMatchObject({ kind: 'meal', name: 'Mittagessen', photoIds: ['p1'] });
    expect(clip.items.map((i) => i.name)).toEqual(['Brot', 'Reis', 'Curry']);
    expect(clipboardKcal(clip)).toBe(580);

    await pasteClipboard(d, foodClipboard(await readClipboard(d))!, { date: '2026-10-06', meal: 2 });
    const pasted = await live(d, '2026-10-06', 2);
    const rows = groupDiaryEntries(pasted);
    expect(rows.map((r) => r.kind)).toEqual(['entry', 'group']);
    expect(pasted[1]).toMatchObject({ mealId: 'm1', aiAnalysisId: 'a1', photoIds: ['p1', 'p2'] });
    expect(pasted[1]!.groupId).not.toBe(source[1]!.groupId);

    // Saved as a meal: every ingredient on its own, the photo of the group.
    const id = await saveMealFromItems(d, clip.name, clip.items, clip.photoIds[0] ?? null);
    const meal = (await d.meals.get(id))!;
    expect(meal.items.map((i) => i.name)).toEqual(['Brot', 'Reis', 'Curry']);
    expect(meal.photoId).toBe('p1');
  });

  it('still pastes a group clipboard stored by an older version (no parts)', async () => {
    const d = db();
    await d.kv.put({
      key: 'clipboard',
      value: {
        kind: 'group',
        name: 'Alt',
        items: [item('A', 1), item('B', 2)],
        mealId: null,
        groupName: 'Alt',
        aiAnalysisId: null,
        photoIds: [],
        copiedAt: 1,
      },
    });
    await pasteClipboard(d, foodClipboard(await readClipboard(d))!, { date: '2026-10-06', meal: 0 });
    const pasted = await live(d, '2026-10-06', 0);
    expect(groupDiaryEntries(pasted)).toHaveLength(1);
    expect(pasted[0]!.groupName).toBe('Alt');
  });
});

describe('diary group editor: "Als Meal speichern"', () => {
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
  const DATE = '2026-10-09';

  it('saves an analysed group as a new meal with the draft and attaches the entries to it', async () => {
    const d = db();
    await logItems(
      d,
      [food('Reis', 130), food('Curry', 200)],
      { date: DATE, meal: 1 },
      {
        groupName: 'Curry vom Foto',
        aiAnalysisId: 'a1',
        photoIds: ['p1', 'p2'],
      },
    );
    const groupId = (await d.foodEntries.toCollection().first())!.groupId!;
    const entries = await groupEntries(d, groupId, DATE);
    const draft = draftFromEntries(entries, 'Curry vom Foto');
    // An open change in the editor goes into the meal and the entries.
    draft.items[0] = { ...rescaleItem(draft.items[0]!, 150), entryId: draft.items[0]!.entryId };
    const mealId = (await saveGroupAsMeal(d, draft, { mode: 'new', name: 'Curry vom Foto' }))!;
    const meal = (await d.meals.get(mealId))!;
    expect(meal).toMatchObject({ name: 'Curry vom Foto', photoId: 'p1', cookedGrams: null });
    expect(meal.items.map((i) => [i.name, i.grams])).toEqual([
      ['Reis', 150],
      ['Curry', 100],
    ]);
    const after = await groupEntries(d, groupId, DATE);
    expect(after.map((e) => [e.mealId, e.groupName, e.aiAnalysisId, e.photoIds, e.grams])).toEqual([
      [mealId, null, 'a1', ['p1', 'p2'], 150],
      [mealId, null, 'a1', ['p1', 'p2'], 100],
    ]);
    expect(await readGroupDraft(d, groupId)).toBeNull();
  });

  it('updates the meal the group came from, keeps its photo and cooked weight, brings a deleted one back', async () => {
    const d = db();
    const items = [food('Reis', 130), food('Huhn', 110)];
    await saveRecord(d, 'meals', { id: 'm1', name: 'Bowl', items, photoId: 'p1', cookedGrams: 500 });
    await logItems(d, items, { date: DATE, meal: 1 }, { mealId: 'm1' });
    await deleteRecord(d, 'meals', 'm1');
    const groupId = (await d.foodEntries.toCollection().first())!.groupId!;
    const entries = await groupEntries(d, groupId, DATE);
    const draft = { ...draftFromEntries(entries, 'Bowl'), name: 'Bowl XL' };
    draft.items = [draft.items[0]!, { ...food('Mais', 90), entryId: null }];
    expect(await saveGroupAsMeal(d, draft, { mode: 'update', name: 'Bowl XL' })).toBe('m1');
    const meal = (await d.meals.get('m1'))!;
    expect(meal).toMatchObject({ name: 'Bowl XL', photoId: 'p1', cookedGrams: 500, deleted: false });
    expect(meal.items.map((i) => i.name)).toEqual(['Reis', 'Mais']);
    const after = await groupEntries(d, groupId, DATE);
    expect(after.map((e) => [e.name, e.mealId, e.groupName])).toEqual([
      ['Reis', 'm1', null],
      ['Mais', 'm1', null],
    ]);
  });

  it('takes photos added in the editor into the entries and as the photo of a new meal', async () => {
    const d = db();
    await logItems(d, [food('A', 100), food('B', 100)], { date: DATE, meal: 0 }, { groupName: 'AB' });
    const groupId = (await d.foodEntries.toCollection().first())!.groupId!;
    await addGroupDraftPhotos(d, groupId, [new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' })]);
    const entries = await groupEntries(d, groupId, DATE);
    const mealId = (await saveGroupAsMeal(d, draftFromEntries(entries, 'AB'), {
      mode: 'new',
      name: 'Mein AB',
    }))!;
    const after = await groupEntries(d, groupId, DATE);
    const photo = after[0]!.photoId!;
    expect(photo).toBeTruthy();
    expect((await d.meals.get(mealId))!.photoId).toBe(photo);
    // The own name differs from the meal's, so it stays.
    expect(after.map((e) => [e.mealId, e.groupName])).toEqual([
      [mealId, 'AB'],
      [mealId, 'AB'],
    ]);
  });
});

describe('diary group editor: a saved meal as ingredients', () => {
  it('appends all ingredients to the group draft, false when the group is gone', async () => {
    const item = (name: string): MealItem => ({
      foodId: `bls:${name}`,
      source: 'bls',
      name,
      brand: null,
      grams: 100,
      portionLabel: '1 g',
      portionGrams: 1,
      quantity: 100,
      per100: { ENERCC: 100 },
      nutrients: { ENERCC: 100 },
    });
    const d = db();
    await logItems(d, [item('A'), item('B')], { date: '2026-10-09', meal: 0 }, { groupName: 'AB' });
    const groupId = (await d.foodEntries.toCollection().first())!.groupId!;
    expect(await addItemsToGroupDraft(d, groupId, '2026-10-09', [item('C'), item('D')])).toBe(true);
    const draft = (await readGroupDraft(d, groupId))!;
    expect(draft.items.map((i) => [i.name, i.entryId === null])).toEqual([
      ['A', false],
      ['B', false],
      ['C', true],
      ['D', true],
    ]);
    expect(await addItemsToGroupDraft(d, 'gone', '2026-10-09', [item('C')])).toBe(false);
  });
});

describe('closing all past days ("Alle vergangenen Tage abschließen")', () => {
  const entry = (date: string, deleted = false) => ({
    id: uuidv7(),
    date,
    meal: 0,
    loggedAt: 1,
    foodId: 'bls:A',
    name: 'A',
    source: 'bls' as const,
    brand: null,
    grams: 50,
    portionLabel: '100 g',
    portionGrams: 100,
    quantity: 0.5,
    per100: null,
    nutrients: { ENERCC: 1 },
    mealId: null,
    aiAnalysisId: null,
    groupId: null,
    groupName: null,
    photoId: null,
    cookedGrams: null,
    photoIds: null,
    note: null,
    deleted,
  });
  const note = (date: string, completedAt: number | null, text = '') => ({
    id: dayId.note(date),
    date,
    note: text,
    completedAt,
  });

  it('openDays: before the shown day, not closed, sorted, without duplicates', () => {
    expect(
      openDays(
        ['2026-11-02', '2026-10-30', '2026-11-02', '2026-11-03', '2026-10-31'],
        [
          { date: '2026-10-31', completedAt: 5 },
          { date: '2026-10-30', completedAt: null },
        ],
        '2026-11-03',
      ),
    ).toEqual(['2026-10-30', '2026-11-02']);
  });

  it('openPastDays ignores days with only deleted entries and the shown day itself', async () => {
    const d = db();
    for (const e of [
      entry('2026-10-30'),
      entry('2026-10-31', true),
      entry('2026-11-01'),
      entry('2026-11-03'),
    ]) {
      const { deleted, ...rec } = e;
      const saved = await saveRecord(d, 'foodEntries', rec);
      if (deleted) await deleteRecord(d, 'foodEntries', saved.id);
    }
    await saveRecord(d, 'dayNotes', note('2026-11-01', 7));
    expect(await openPastDays(d, '2026-11-03')).toEqual(['2026-10-30']);
  });

  it('completeDays skips closed days and keeps the note; reopenDays undoes only those days', async () => {
    const d = db();
    for (const day of ['2026-10-29', '2026-10-30', '2026-10-31']) {
      const { deleted: _, ...rec } = entry(day);
      await saveRecord(d, 'foodEntries', rec);
    }
    await saveRecord(d, 'dayNotes', note('2026-10-30', null, 'Lauf'));
    await saveRecord(d, 'dayNotes', note('2026-10-31', 5));
    await d.outbox.clear();

    const open = await openPastDays(d, '2026-11-01');
    expect(open).toEqual(['2026-10-29', '2026-10-30']);
    // Another device closed one more in the meantime: it is skipped and keeps its time.
    const closed = await completeDays(d, [...open, '2026-10-31'], 1000);
    expect(closed).toEqual(['2026-10-29', '2026-10-30']);
    expect(await d.outbox.count()).toBe(2);
    expect(await d.dayNotes.get(dayId.note('2026-10-30'))).toMatchObject({ note: 'Lauf', completedAt: 1000 });
    expect(await d.dayNotes.get(dayId.note('2026-10-29'))).toMatchObject({ note: '', completedAt: 1000 });
    expect(await openPastDays(d, '2026-11-01')).toEqual([]);

    await reopenDays(d, closed);
    expect(await d.dayNotes.get(dayId.note('2026-10-30'))).toMatchObject({ note: 'Lauf', completedAt: null });
    expect(await d.dayNotes.get(dayId.note('2026-10-29'))).toMatchObject({ completedAt: null });
    expect(await d.dayNotes.get(dayId.note('2026-10-31'))).toMatchObject({ completedAt: 5 });
    expect(await openPastDays(d, '2026-11-01')).toEqual(['2026-10-29', '2026-10-30']);
  });
});

describe('saved training editor draft', () => {
  const run = {
    typeKey: 'running',
    typeName: 'Laufen',
    minutes: 40,
    intensity: 'moderate' as const,
    note: null,
  };
  const stretch = {
    typeKey: 'stretching',
    typeName: 'Dehnen',
    minutes: 15,
    intensity: 'light' as const,
    note: null,
  };

  it('creates a new training only on save; an empty new draft has no record', async () => {
    const d = db();
    const id = await startNewTraining(d);
    expect(await d.exerciseTemplates.get(id)).toBeUndefined();
    expect(await readTrainingDraft(d, id)).toMatchObject({ isNew: true, items: [] });
    expect(await addActivityToTraining(d, id, run)).toBe(true);
    expect(await addActivityToTraining(d, id, stretch)).toBe(true);
    const draft = (await readTrainingDraft(d, id))!;
    expect(draft.items.map((i) => i.typeKey)).toEqual(['running', 'stretching']);
    expect(await saveTrainingDraft(d, { ...draft, name: 'Bahn und Dehnen', pinned: true })).toBe(true);
    const saved = (await d.exerciseTemplates.get(id))!;
    expect(saved).toMatchObject({ name: 'Bahn und Dehnen', typeKey: 'running', pinned: true });
    expect(trainingItemsOf(saved).map((i) => i.typeKey)).toEqual(['running', 'stretching']);
    expect(await readTrainingDraft(d, id)).toBeNull();
  });

  it('adds to a draft of an existing training and saves only the draft fields', async () => {
    const d = db();
    const id = await saveTraining(d, { name: 'Bahntraining', items: [run] });
    expect(await addActivityToTraining(d, id, stretch)).toBe(true);
    const draft = (await readTrainingDraft(d, id))!;
    expect(draft).toMatchObject({ name: 'Bahntraining', pinned: false });
    expect(isTrainingDirty(draft, (await d.exerciseTemplates.get(id))!)).toBe(true);
    expect(await saveTrainingDraft(d, draft)).toBe(true);
    expect(trainingItemsOf((await d.exerciseTemplates.get(id))!)).toHaveLength(2);
    await deleteRecord(d, 'exerciseTemplates', id);
    expect(await addActivityToTraining(d, id, run)).toBe(false);
    expect(await addActivityToTraining(d, 'missing', run)).toBe(false);
  });
});

describe('"Gerätedaten löschen": what is only on this device', () => {
  it('counts changes, photos waiting for upload, analyses and drafts', async () => {
    const d = db();
    expect(wipeWarning(await localOnlyData(d))).toBe(
      'Alle Daten bleiben auf dem Server und kommen nach der nächsten Anmeldung zurück.',
    );
    await saveRecord(d, 'weightEntries', { id: dayId.weight('2026-10-07'), date: '2026-10-07', kg: 80 });
    await d.outbox.clear();
    const uploaded = await storePhoto(d, new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
    await d.photos.update(uploaded, { uploaded: 1 });
    await storePhoto(d, new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
    await storePhoto(d, new Blob([new Uint8Array([0xff, 0xd8, 0xff])]));
    await d.aiQueue.add({ createdAt: 1, date: '2026-10-07', meal: 1, text: '', status: 'pending' });
    await d.kv.put({ key: 'mealDraft:m1', value: {} });
    await d.kv.put({ key: 'mealDraftPhoto:m1', value: {} });
    await d.kv.put({ key: 'clipboard', value: {} });
    const turn = { requestId: 'r', createdAt: 1, source: 'voice' as const, shownDate: '2026-10-07' };
    await d.assistantTurns.bulkAdd([
      { ...turn, status: 'waiting' },
      { ...turn, status: 'failed' },
      { ...turn, status: 'done' },
    ]);
    const local = await localOnlyData(d);
    expect(local).toEqual({ changes: 0, photos: 2, analyses: 1, drafts: 1, utterances: 2 });
    expect(wipeWarning(local)).toBe(
      'Noch nicht hochgeladen: 2 Fotos. Vor dem Löschen wird noch einmal versucht, sie hochzuladen; ' +
        'gelingt das nicht, gehen sie verloren. Nur auf diesem Gerät, gehen verloren: 1 Analyse, 1 Entwurf, 2 Aufnahmen.',
    );
  });
});

describe('training order (drag in the training card)', () => {
  const row = (typeKey: string, group?: string) => ({
    typeKey,
    name: typeKey,
    minutes: 30,
    intensity: 'moderate' as const,
    met: 6,
    weightKg: 80,
    kcal: 200,
    note: null,
    ...(group !== undefined && { group, templateId: 't1' }),
  });
  const day = '2026-11-08';
  const order = async (d: UserDb) =>
    (await d.exerciseEntries.where('date').equals(day).sortBy('loggedAt'))
      .filter((e) => !e.deleted)
      .map((e) => e.typeKey);

  it('moves a package as a whole, writes only entries whose place changed, undo restores the order', async () => {
    const d = db();
    const [run, strength, , cycling] = await logTrainings(d, day, [
      row('running'),
      row('strength', 'a'),
      row('stretching', 'a'),
      row('cycling'),
    ]);
    const groupId = (await d.exerciseEntries.get(strength!))!.groupId!;
    const before = await d.exerciseEntries.where('date').equals(day).sortBy('loggedAt');
    await d.outbox.clear();
    const previous = await reorderTrainings(d, day, [cycling!, `group:${groupId}`, run!]);
    expect(previous).toEqual([run, `group:${groupId}`, cycling]);
    expect(await order(d)).toEqual(['cycling', 'strength', 'stretching', 'running']);
    // The package keeps its places 1 and 2: its activities are not written again.
    for (const e of before.filter((e) => e.groupId === groupId)) {
      expect(await d.exerciseEntries.get(e.id)).toEqual(e);
    }
    expect((await d.outbox.toArray()).map((o) => o.id).sort()).toEqual([cycling, run].sort());
    const after = await d.exerciseEntries.where('date').equals(day).sortBy('loggedAt');
    expect(after.map((e) => e.loggedAt)).toEqual(before.map((e) => e.loggedAt));

    await reorderTrainings(d, day, previous);
    expect(await order(d)).toEqual(['running', 'strength', 'stretching', 'cycling']);
  });

  it('ignores unknown and deleted keys, appends rows left out, never touches the steps', async () => {
    const d = db();
    await saveRecord(d, 'exerciseEntries', {
      ...row('steps'),
      id: dayId.steps(day),
      date: day,
      name: 'Schritte',
      loggedAt: 1,
      templateId: null,
      groupId: null,
      steps: 8432,
      distanceM: null,
    });
    const steps = await d.exerciseEntries.get(dayId.steps(day));
    const [run, strength, , cycling] = await logTrainings(d, day, [
      row('running'),
      row('strength', 'a'),
      row('stretching', 'a'),
      row('cycling'),
    ]);
    const groupId = (await d.exerciseEntries.get(strength!))!.groupId!;
    await deleteRecord(d, 'exerciseEntries', run!);
    await reorderTrainings(d, day, [run!, 'nope', cycling!]);
    expect(await order(d)).toEqual(['steps', 'cycling', 'strength', 'stretching']);
    expect(await d.exerciseEntries.get(dayId.steps(day))).toEqual(steps);
    expect(await reorderTrainings(d, day, [`group:${groupId}`])).toEqual([cycling, `group:${groupId}`]);
    expect(await order(d)).toEqual(['steps', 'strength', 'stretching', 'cycling']);
  });
});
