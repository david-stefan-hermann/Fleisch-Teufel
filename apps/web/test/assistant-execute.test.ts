import { dayId, uuidv7, type AssistantOp, type Food } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import { logTrainings } from '@/db/entries';
import { runUndo } from '@/db/undo';
import { saveRecord } from '@/db/write';
import { applyOps, summaryText, type ApplyEnv } from '@/features/assistant/execute';

const db = () => new UserDb(`t-${uuidv7()}`);
const TODAY = '2026-11-13';
// 20:15 local time on TODAY: dinner by the clock.
const NOW = new Date(2026, 10, 13, 20, 15).getTime();
const env: ApplyEnv = {
  now: NOW,
  today: TODAY,
  mealNames: ['Frühstück', 'Mittagessen', 'Abendessen', 'Snacks'],
};

const food = (id: string, name: string, kcal: number, portions: Food['portions'] = []): Food => ({
  id,
  source: 'bls',
  sourceId: id.slice(4),
  name,
  nameEn: null,
  brand: null,
  group: null,
  unit: 'g',
  nutrients: { ENERCC: kcal, PROT625: 10 },
  portions,
  imageUrl: null,
});
const quark = food('bls:M1', 'Magerquark', 67, [{ label: 'Packung (500 g)', grams: 500 }]);
const banana = food('bls:F1', 'Banane', 90, [{ label: 'Stück (120 g)', grams: 120 }]);

const logFood = (over: Partial<Extract<AssistantOp, { kind: 'logFood' }>> = {}): AssistantOp => ({
  kind: 'logFood',
  date: TODAY,
  meal: 1,
  items: [
    { food: quark, grams: 200, portion: null, guessed: false },
    { food: banana, grams: 120, portion: { label: 'Stück (120 g)', grams: 120 }, guessed: true },
  ],
  groupName: null,
  ...over,
});

const live = async (d: UserDb) => (await d.foodEntries.toArray()).filter((e) => !e.deleted);

describe('applyOps (the assistant carries out its operations on the device)', () => {
  it('logs foods with their nutrients, one outbox row per write, and undoes them', async () => {
    const d = db();
    const r = await applyOps(d, [logFood()], env);
    const entries = await live(d);
    expect(entries.map((e) => [e.name, e.grams, e.meal, e.source])).toEqual([
      ['Magerquark', 200, 1, 'bls'],
      ['Banane', 120, 1, 'bls'],
    ]);
    expect(entries[1]).toMatchObject({
      portionLabel: 'Stück (120 g)',
      quantity: 1,
      nutrients: { ENERCC: 108 },
    });
    expect(await d.outbox.count()).toBe(2);
    expect(r.applied[0]).toMatchObject({
      text: 'Mittagessen: Magerquark, Banane',
      kcal: 134 + 108,
      guessed: true,
    });
    expect(summaryText(r.applied)).toBe('Mittagessen: Magerquark, Banane · 242 kcal');
    expect(await d.foodCache.count()).toBe(2);
    await runUndo(d, r.undo);
    expect(await live(d)).toEqual([]);
  });

  it('logs a named dish as one group', async () => {
    const d = db();
    await applyOps(d, [logFood({ groupName: 'Quark mit Banane' })], env);
    const entries = await live(d);
    expect(new Set(entries.map((e) => e.groupId)).size).toBe(1);
    expect(entries[0]!.groupName).toBe('Quark mit Banane');
  });

  it('without a meal: the meal of an entry made minutes ago, else the clock', async () => {
    const d = db();
    const r = await applyOps(d, [logFood({ meal: null })], env);
    expect(r.applied[0]!.target).toEqual({ date: TODAY, meal: 2 });
    const e = db();
    await saveRecord(e, 'foodEntries', {
      ...(await live(d))[0]!,
      id: uuidv7(),
      meal: 3,
      loggedAt: NOW - 5 * 60_000,
    });
    const r2 = await applyOps(e, [logFood({ meal: null }), logFood({ meal: null, date: TODAY })], env);
    expect(r2.applied.map((a) => a.target)).toEqual([
      { date: TODAY, meal: 3 },
      { date: TODAY, meal: 3 },
    ]);
  });

  it('over midnight a sentence without a meal goes to the meal of the entry made just before', async () => {
    const d = db();
    const late = { ...env, now: new Date(2026, 10, 14, 0, 5).getTime(), today: '2026-11-14' };
    const [chips] = (await applyOps(d, [logFood({ meal: 3 })], env)).applied[0]!.entryIds ?? [];
    await d.foodEntries.update(chips!, { loggedAt: late.now - 10 * 60_000 });
    const r = await applyOps(d, [logFood({ meal: null, date: '2026-11-14' })], late);
    expect(r.applied[0]!.target).toEqual({ date: TODAY, meal: 3 });
  });

  it('a training counts with the weight set earlier in the same sentence', async () => {
    const d = db();
    await saveRecord(d, 'weightEntries', { id: dayId.weight(TODAY), date: TODAY, kg: 80 });
    await applyOps(
      d,
      [
        { kind: 'setWeight', date: TODAY, kg: 100 },
        {
          kind: 'logTraining',
          date: TODAY,
          items: [{ typeKey: 'running', templateId: null, minutes: 60, intensity: 'moderate' }],
        },
      ],
      env,
    );
    const [entry] = await d.exerciseEntries.where('date').equals(TODAY).toArray();
    expect(entry!.weightKg).toBe(100);
  });

  it('sets a weight over a deleted one and brings the deleted one back on undo', async () => {
    const d = db();
    const id = dayId.weight(TODAY);
    await saveRecord(d, 'weightEntries', { id, date: TODAY, kg: 81, deleted: true });
    const r = await applyOps(d, [{ kind: 'setWeight', date: TODAY, kg: 79.9 }], env);
    expect(await d.weightEntries.get(id)).toMatchObject({ kg: 79.9, deleted: false });
    expect(r.applied[0]!.text).toBe('Gewicht: 79,9 kg');
    await runUndo(d, r.undo);
    expect(await d.weightEntries.get(id)).toMatchObject({ kg: 81, deleted: true });

    const fresh = await applyOps(d, [{ kind: 'setWeight', date: '2026-11-12', kg: 80 }], env);
    expect(fresh.applied[0]!.text).toBe('Gestern, Gewicht: 80 kg');
    await runUndo(d, fresh.undo);
    expect(await d.weightEntries.get(dayId.weight('2026-11-12'))).toMatchObject({ deleted: true });
  });

  it('changes amounts, moves and deletes entries, each undone exactly', async () => {
    const d = db();
    await applyOps(d, [logFood()], env);
    const [q, b] = await live(d);
    const r = await applyOps(
      d,
      [
        { kind: 'updateEntry', entryId: q!.id, grams: 750 },
        { kind: 'moveEntries', entryIds: [q!.id], toDate: '2026-11-12', toMeal: 0 },
        { kind: 'deleteEntries', entryIds: [b!.id] },
      ],
      env,
    );
    const moved = await d.foodEntries.get(q!.id);
    expect(moved).toMatchObject({ grams: 750, date: '2026-11-12', meal: 0, nutrients: { ENERCC: 502.5 } });
    expect((await d.foodEntries.get(b!.id))!.deleted).toBe(true);
    expect(r.applied.map((a) => a.text)).toEqual([
      'Magerquark: 750\u00a0g',
      'Verschoben nach Gestern, Frühstück: Magerquark',
      'Gelöscht: Banane',
    ]);
    await runUndo(d, r.undo);
    expect(await d.foodEntries.get(q!.id)).toMatchObject({
      grams: 200,
      date: TODAY,
      meal: 1,
      nutrients: { ENERCC: 134 },
    });
    expect((await d.foodEntries.get(b!.id))!.deleted).toBe(false);
  });

  it('leaves out operations on records this device does not have', async () => {
    const d = db();
    const r = await applyOps(
      d,
      [
        { kind: 'deleteEntries', entryIds: [uuidv7()] },
        { kind: 'logSavedMeal', date: TODAY, meal: 0, mealId: uuidv7() },
        { kind: 'setWeight', date: TODAY, kg: 80 },
      ],
      env,
    );
    expect(r.skipped).toBe(2);
    expect(r.applied).toHaveLength(1);
  });

  it('writes nothing when one operation fails', async () => {
    const d = db();
    const bad = logFood({ items: [{ food: quark, grams: -5, portion: null, guessed: false }] });
    await expect(applyOps(d, [{ kind: 'setWeight', date: TODAY, kg: 80 }, bad], env)).rejects.toThrow();
    expect(await d.weightEntries.count()).toBe(0);
    expect(await d.outbox.count()).toBe(0);
  });

  it('logs trainings with the last values of a sport and the activities of a saved training', async () => {
    const d = db();
    await logTrainings(d, '2026-11-10', [
      {
        typeKey: 'badminton',
        name: 'Badminton',
        minutes: 90,
        intensity: 'vigorous',
        met: 7,
        weightKg: 80,
        kcal: 700,
        note: null,
      },
    ]);
    await saveRecord(d, 'exerciseTemplates', {
      id: 't1',
      name: 'Mobility Patty',
      typeKey: 'yoga',
      typeName: 'Yoga',
      minutes: 20,
      intensity: 'light',
      note: null,
      extraItems: null,
      pinned: null,
    });
    await saveRecord(d, 'weightEntries', { id: dayId.weight(TODAY), date: TODAY, kg: 80 });
    const r = await applyOps(
      d,
      [
        {
          kind: 'logTraining',
          date: TODAY,
          items: [
            { typeKey: 'badminton', templateId: null, minutes: null, intensity: null },
            { typeKey: null, templateId: 't1', minutes: null, intensity: null },
          ],
        },
      ],
      env,
    );
    const today = (await d.exerciseEntries.where('date').equals(TODAY).sortBy('loggedAt')).map((e) => [
      e.typeKey,
      e.minutes,
      e.intensity,
      e.templateId,
    ]);
    expect(today).toEqual([
      ['badminton', 90, 'vigorous', null],
      ['yoga', 20, 'light', 't1'],
    ]);
    expect(r.applied[0]!.text).toBe('Training: Badminton, 90 Min., Mobility Patty');
    await runUndo(d, r.undo);
    expect((await d.exerciseEntries.where('date').equals(TODAY).toArray()).every((e) => e.deleted)).toBe(
      true,
    );
  });

  it('hands the camera to the caller and copies a meal from yesterday', async () => {
    const d = db();
    await applyOps(d, [logFood({ date: '2026-11-12', meal: 0 })], env);
    const ids = (await live(d)).map((e) => e.id);
    const r = await applyOps(
      d,
      [
        { kind: 'copyEntries', entryIds: ids, toDate: TODAY, toMeal: 0 },
        { kind: 'openCamera', date: TODAY, meal: 1, hint: 'Die Soße war Kräutersoße.', replaces: [] },
      ],
      env,
    );
    expect((await d.foodEntries.where('date').equals(TODAY).toArray()).map((e) => e.name)).toEqual([
      'Magerquark',
      'Banane',
    ]);
    expect(r.camera).toMatchObject({ meal: 1, hint: 'Die Soße war Kräutersoße.' });
  });
});
