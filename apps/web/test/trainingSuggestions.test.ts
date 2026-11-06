import { addDays, uuidv7, type Intensity } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import { logTrainings, saveExerciseTemplate } from '@/db/entries';
import { deleteRecord, patchRecord } from '@/db/write';
import { trainingHistory } from '@/db/trainingSuggestions';

const db = () => new UserDb(`t-${uuidv7()}`);
const TODAY = '2026-10-26'; // a Monday

const row = (
  typeKey: string,
  minutes: number,
  intensity: Intensity = 'moderate',
  note: string | null = null,
) => ({
  typeKey,
  name: typeKey,
  minutes,
  intensity,
  met: 6,
  weightKg: 80,
  kcal: 200,
  note,
  templateId: null as string | null,
});

describe('trainingHistory ("Zuletzt & häufig")', () => {
  it('ranks by frequency and recency, the same weekday higher, with the values of the last time', async () => {
    const d = db();
    // Running three times (last one 40 min, intensive), gym once but on a Monday, yoga long ago.
    await logTrainings(d, addDays(TODAY, -20), [row('running', 30)]);
    await logTrainings(d, addDays(TODAY, -10), [row('running', 30)]);
    await logTrainings(d, addDays(TODAY, -3), [row('running', 40, 'vigorous', 'Intervalle')]);
    await logTrainings(d, addDays(TODAY, -7), [row('gym', 60)]);
    await logTrainings(d, addDays(TODAY, -59), [row('yoga', 45)]);
    await logTrainings(d, addDays(TODAY, -61), [row('swimming', 45)]);
    const h = await trainingHistory(d, TODAY);
    expect(h.suggestions.map((s) => s.typeKey)).toEqual(['running', 'gym', 'yoga']);
    expect(h.suggestions[0]).toMatchObject({
      minutes: 40,
      intensity: 'vigorous',
      note: 'Intervalle',
      count: 3,
    });
    expect(h.suggestions[1]!.count).toBe(1);
    // The last values of every sport in the window, also the ones not suggested.
    expect(h.last.get('yoga')?.minutes).toBe(45);
    expect(h.last.has('swimming')).toBe(false);
  });

  it('leaves out what the day already has and cuts to the limit', async () => {
    const d = db();
    for (const [i, key] of ['a', 'b', 'c', 'd', 'e', 'f', 'g'].entries())
      await logTrainings(d, addDays(TODAY, -1 - i), [row(key, 20 + i)]);
    await logTrainings(d, TODAY, [row('a', 20)]);
    const h = await trainingHistory(d, TODAY);
    // 'g' was logged a week ago, on the same weekday, and moves up; 'a' is already logged today.
    expect(h.suggestions.map((s) => s.typeKey)).toEqual(['g', 'b', 'c', 'd', 'e', 'f']);
    expect(h.last.get('a')?.minutes).toBe(20);
    expect((await trainingHistory(d, TODAY, { limit: 2 })).suggestions.map((s) => s.typeKey)).toEqual([
      'g',
      'b',
    ]);
    // The page "Training eintragen" keeps what the day already has (a second run of the day).
    expect((await trainingHistory(d, TODAY, { withLogged: true })).suggestions.map((s) => s.typeKey)).toEqual(
      ['a', 'g', 'b', 'c', 'd', 'e'],
    );
  });

  it('the same weekday counts more than a day nearer in the week', async () => {
    const d = db();
    await logTrainings(d, addDays(TODAY, -7), [row('monday', 30)]);
    await logTrainings(d, addDays(TODAY, -5), [row('wednesday', 30)]);
    const h = await trainingHistory(d, TODAY);
    expect(h.suggestions.map((s) => s.typeKey)).toEqual(['monday', 'wednesday']);
  });

  it('a deleted training does not count', async () => {
    const d = db();
    const [id] = await logTrainings(d, addDays(TODAY, -1), [row('running', 30)]);
    await d.exerciseEntries.update(id!, { deleted: true });
    expect((await trainingHistory(d, TODAY)).suggestions).toEqual([]);
  });

  it('a saved training is a suggestion of its own, named like it, with the values of the last time', async () => {
    const d = db();
    const saved = async (name: string, minutes: number) =>
      saveExerciseTemplate(d, {
        name,
        typeKey: 'strength',
        typeName: 'Krafttraining',
        minutes,
        intensity: 'moderate',
        note: null,
      });
    const push = await saved('Push Day', 60);
    const pull = await saved('Pull Day', 60);
    const from = (templateId: string | null, minutes: number, note: string | null = null) => ({
      ...row('strength', minutes, 'vigorous', note),
      name: 'Krafttraining',
      templateId,
    });
    await logTrainings(d, addDays(TODAY, -8), [from(push, 60)]);
    await logTrainings(d, addDays(TODAY, -1), [from(push, 75, 'Bank 5 × 5')]);
    await logTrainings(d, addDays(TODAY, -3), [from(pull, 50)]);
    await logTrainings(d, addDays(TODAY, -5), [from(null, 30)]);
    const h = await trainingHistory(d, TODAY);
    // Two saved trainings of one sport and the sport itself: three suggestions.
    expect(h.suggestions.map((s) => [s.key, s.templateName, s.count])).toEqual([
      [`t:${push}`, 'Push Day', 2],
      [`t:${pull}`, 'Pull Day', 1],
      ['strength', null, 1],
    ]);
    // What was logged last time, not what the saved training says (60 min, no note).
    expect(h.suggestions[0]).toMatchObject({
      templateId: push,
      typeKey: 'strength',
      name: 'Krafttraining',
      minutes: 75,
      intensity: 'vigorous',
      note: 'Bank 5 × 5',
    });
    // The values per sport (sport picker) are the ones of the sport's last entry, whatever it came from.
    expect(h.last.get('strength')).toMatchObject({ minutes: 75 });

    // Renamed: the suggestion follows the name.
    await patchRecord(d, 'exerciseTemplates', push, { name: 'Brust und Trizeps' });
    expect((await trainingHistory(d, TODAY)).suggestions[0]!.templateName).toBe('Brust und Trizeps');

    // Logged today from "Pull Day": only that one is taken out, the sport and "Push" stay.
    await logTrainings(d, TODAY, [from(pull, 50)]);
    expect((await trainingHistory(d, TODAY)).suggestions.map((s) => s.key)).toEqual([
      `t:${push}`,
      'strength',
    ]);

    // A deleted saved training falls back to its sport: its entries count there.
    await deleteRecord(d, 'exerciseTemplates', push);
    const after = await trainingHistory(d, TODAY, { withLogged: true });
    expect(after.suggestions.map((s) => [s.key, s.count, s.templateId])).toEqual([
      ['strength', 3, null],
      [`t:${pull}`, 2, pull],
    ]);
    expect(after.suggestions[0]).toMatchObject({ minutes: 75, templateName: null });
  });
});
