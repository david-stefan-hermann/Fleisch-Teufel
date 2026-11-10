import { addDays, uuidv7, type Intensity } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import { logTrainings, saveTraining, updateTraining } from '@/db/entries';
import { deleteRecord, saveRecord } from '@/db/write';
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
    expect(h.suggestions.map((s) => s.key)).toEqual(['running', 'gym', 'yoga']);
    expect(h.suggestions[0]).toMatchObject({ count: 3, title: 'running', templateId: null, pinned: false });
    expect(h.suggestions[0]!.items).toEqual([
      { typeKey: 'running', name: 'running', minutes: 40, intensity: 'vigorous', note: 'Intervalle' },
    ]);
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
    expect(h.suggestions.map((s) => s.key)).toEqual(['g', 'b', 'c', 'd', 'e', 'f']);
    expect(h.last.get('a')?.minutes).toBe(20);
    expect((await trainingHistory(d, TODAY, { limit: 2 })).suggestions.map((s) => s.key)).toEqual(['g', 'b']);
    // The page "Training eintragen" keeps what the day already has (a second run of the day).
    expect((await trainingHistory(d, TODAY, { withLogged: true })).suggestions.map((s) => s.key)).toEqual([
      'a',
      'g',
      'b',
      'c',
      'd',
      'e',
    ]);
  });

  it('the same weekday counts more than a day nearer in the week', async () => {
    const d = db();
    await logTrainings(d, addDays(TODAY, -7), [row('monday', 30)]);
    await logTrainings(d, addDays(TODAY, -5), [row('wednesday', 30)]);
    const h = await trainingHistory(d, TODAY);
    expect(h.suggestions.map((s) => s.key)).toEqual(['monday', 'wednesday']);
  });

  it('a deleted training does not count', async () => {
    const d = db();
    const [id] = await logTrainings(d, addDays(TODAY, -1), [row('running', 30)]);
    await d.exerciseEntries.update(id!, { deleted: true });
    expect((await trainingHistory(d, TODAY)).suggestions).toEqual([]);
  });

  it('steps from Apple Health are never a suggestion', async () => {
    const d = db();
    await saveRecord(d, 'exerciseEntries', {
      ...row('steps', 84),
      id: 's:2026-10-25',
      date: addDays(TODAY, -1),
      name: 'Schritte',
      loggedAt: 1,
      groupId: null,
      steps: 8432,
      distanceM: null,
    });
    const h = await trainingHistory(d, TODAY);
    expect(h.suggestions).toEqual([]);
    expect(h.last.has('steps')).toBe(false);
  });

  it('a saved training is a suggestion of its own with its saved values, counted once per logging', async () => {
    const d = db();
    const strength = (minutes: number) => ({
      typeKey: 'strength',
      typeName: 'Krafttraining',
      minutes,
      intensity: 'moderate' as const,
      note: null,
    });
    const stretch = {
      typeKey: 'stretching',
      typeName: 'Dehnen',
      minutes: 15,
      intensity: 'light' as const,
      note: null,
    };
    const push = await saveTraining(d, { name: 'Push Day', items: [strength(60), stretch] });
    const pull = await saveTraining(d, { name: 'Pull Day', items: [strength(60)] });
    const from = (templateId: string | null, minutes: number, note: string | null = null) => ({
      ...row('strength', minutes, 'vigorous', note),
      name: 'Krafttraining',
      templateId,
      ...(templateId && { group: templateId }),
    });
    const part = (templateId: string) => ({ ...row('stretching', 15), templateId, group: templateId });
    await logTrainings(d, addDays(TODAY, -8), [from(push, 60), part(push)]);
    await logTrainings(d, addDays(TODAY, -1), [from(push, 75, 'Bank 5 × 5'), part(push)]);
    await logTrainings(d, addDays(TODAY, -3), [from(pull, 50)]);
    await logTrainings(d, addDays(TODAY, -5), [from(null, 30)]);
    // An old single entry with the saved training (before packages): counts for it too.
    await logTrainings(d, addDays(TODAY, -12), [{ ...from(null, 45), templateId: push }]);
    const h = await trainingHistory(d, TODAY);
    // Two saved trainings of one sport and the sport itself: three suggestions; two activities count once.
    expect(h.suggestions.map((s) => [s.key, s.title, s.count])).toEqual([
      [`t:${push}`, 'Push Day', 3],
      [`t:${pull}`, 'Pull Day', 1],
      ['strength', 'Krafttraining', 1],
    ]);
    // What the saved training says, not what was logged last time (75 min, a note).
    expect(h.suggestions[0]!.items).toEqual([
      { typeKey: 'strength', name: 'Krafttraining', minutes: 60, intensity: 'moderate', note: null },
      { typeKey: 'stretching', name: 'Dehnen', minutes: 15, intensity: 'light', note: null },
    ]);
    // The sport keeps the values of last time.
    expect(h.suggestions[2]!.items).toEqual([
      { typeKey: 'strength', name: 'Krafttraining', minutes: 30, intensity: 'vigorous', note: null },
    ]);
    // The values per sport are the ones of the sport's last entry, parts of saved trainings included.
    expect(h.last.get('strength')).toMatchObject({ minutes: 75, note: 'Bank 5 × 5' });
    expect(h.stats.get(`t:${push}`)).toEqual({ count: 3, lastDate: addDays(TODAY, -1) });
    expect(h.stats.get('strength')).toEqual({ count: 1, lastDate: addDays(TODAY, -5) });

    // Changed and renamed: the suggestion follows the saved training.
    await updateTraining(d, push, { name: 'Brust und Trizeps', items: [strength(50)] });
    const changed = (await trainingHistory(d, TODAY)).suggestions[0]!;
    expect(changed.title).toBe('Brust und Trizeps');
    expect(changed.items.map((i) => i.minutes)).toEqual([50]);

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
      ['strength', 4, null],
      [`t:${pull}`, 2, pull],
      ['stretching', 2, null],
    ]);
    expect(after.suggestions[0]!.items[0]).toMatchObject({ minutes: 75 });
  });

  it('puts pinned saved trainings first, also never logged ones, and leaves them out once logged today', async () => {
    const d = db();
    await logTrainings(d, addDays(TODAY, -1), [row('running', 30)]);
    await logTrainings(d, addDays(TODAY, -2), [row('running', 30)]);
    const item = {
      typeKey: 'yoga',
      typeName: 'Yoga',
      minutes: 30,
      intensity: 'moderate' as const,
      note: null,
    };
    const b = await saveTraining(d, { name: 'B-Yoga', items: [item], pinned: true });
    const a = await saveTraining(d, { name: 'A-Yoga', items: [item], pinned: true });
    await saveTraining(d, { name: 'Not pinned', items: [item] });
    const h = await trainingHistory(d, TODAY);
    expect(h.suggestions.map((s) => s.key)).toEqual([`t:${a}`, `t:${b}`, 'running']);
    expect(h.suggestions[0]).toMatchObject({ pinned: true, count: 0, lastDate: null, title: 'A-Yoga' });
    await logTrainings(d, TODAY, [{ ...row('yoga', 30), templateId: a, group: 'x' }]);
    expect((await trainingHistory(d, TODAY)).suggestions.map((s) => s.key)).toEqual([`t:${b}`, 'running']);
  });
});
