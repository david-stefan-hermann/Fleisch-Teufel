import { addDays, uuidv7, type Intensity } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import { logTrainings } from '@/db/entries';
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
});
